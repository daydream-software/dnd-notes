// Tests for the pure decision logic in cleanup-ghcr-versions.mjs.
// Run with: node --test scripts/platform/cleanup-ghcr-versions.test.mjs

import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyVersion, decide } from './cleanup-ghcr-versions.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeVersion(id, tags, created_at = `2026-01-${String(id).padStart(2, '0')}T00:00:00Z`) {
  return {
    id,
    name: `sha256:deadbeef${String(id).padStart(56, '0')}`,
    created_at,
    metadata: { container: { tags } },
  };
}

// ---------------------------------------------------------------------------
// classifyVersion
// ---------------------------------------------------------------------------

test('classifyVersion', async (t) => {
  await t.test('untagged when tags array is empty', () => {
    assert.equal(classifyVersion(makeVersion(1, [])), 'untagged');
  });

  await t.test('prod when any tag starts with prod-', () => {
    assert.equal(classifyVersion(makeVersion(1, ['prod-20260101'])), 'prod');
  });

  await t.test('prod beats sha when both present', () => {
    assert.equal(classifyVersion(makeVersion(1, ['sha-abc1234', 'prod-20260101'])), 'prod');
  });

  await t.test('sha when only sha- tags', () => {
    assert.equal(classifyVersion(makeVersion(1, ['sha-abc1234'])), 'sha');
  });

  await t.test('sha when latest tag present', () => {
    assert.equal(classifyVersion(makeVersion(1, ['sha-abc1234', 'latest'])), 'sha');
  });

  await t.test('sha when only latest tag', () => {
    assert.equal(classifyVersion(makeVersion(1, ['latest'])), 'sha');
  });

  await t.test('unknown for unrecognised tags', () => {
    assert.equal(classifyVersion(makeVersion(1, ['v1.2.3'])), 'unknown');
  });
});

// ---------------------------------------------------------------------------
// decide — basic cases
// ---------------------------------------------------------------------------

test('decide — untagged versions are always deleted', () => {
  const versions = [makeVersion(1, []), makeVersion(2, ['sha-aaa1111'])];
  const result = decide(versions);
  assert.equal(result.delete.length, 1);
  assert.equal(result.delete[0].id, 1);
  assert.equal(result.keep.length, 1);
  assert.equal(result.keep[0].id, 2);
});

test('decide — keeps 10 newest sha-* versions, deletes older ones', () => {
  // 12 sha-* versions, oldest first (id = day of month).
  const versions = Array.from({ length: 12 }, (_, i) =>
    makeVersion(i + 1, [`sha-${String(i + 1).padStart(7, 'a')}`], `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
  );
  const result = decide(versions);
  assert.equal(result.keep.length, 10);
  assert.equal(result.delete.length, 2);
  // The 2 oldest (id=1, id=2) should be deleted.
  const deletedIds = result.delete.map((v) => v.id).sort((a, b) => a - b);
  assert.deepEqual(deletedIds, [1, 2]);
});

test('decide — keeps 3 newest prod-* versions, deletes older ones', () => {
  const versions = Array.from({ length: 5 }, (_, i) =>
    makeVersion(i + 1, [`prod-202601${String(i + 1).padStart(2, '0')}`], `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
  );
  const result = decide(versions);
  assert.equal(result.keep.length, 3);
  assert.equal(result.delete.length, 2);
  // The 2 oldest (id=1, id=2) should be deleted.
  const deletedIds = result.delete.map((v) => v.id).sort((a, b) => a - b);
  assert.deepEqual(deletedIds, [1, 2]);
});

test('decide — prod-* version is NOT counted in sha-* slot window', () => {
  // 10 sha-only + 1 version with BOTH sha-* and prod-* + 1 extra sha (would overflow without prod exclusion)
  const versions = [
    // 1 version with both sha and prod tags (counts as prod, not sha)
    makeVersion(100, ['sha-abc1234', 'prod-20260101'], '2026-01-15T00:00:00Z'),
    // 11 sha-only versions (id 1..11, oldest first)
    ...Array.from({ length: 11 }, (_, i) =>
      makeVersion(i + 1, [`sha-${String(i + 1).padStart(7, 'a')}`], `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
    ),
  ];
  const result = decide(versions);

  // version 100 (sha+prod) must be in keep (as prod)
  const kept = result.keep.map((v) => v.id);
  assert.ok(kept.includes(100), 'version 100 (sha+prod) should be kept');

  // sha-* window = 10; with 11 sha-only versions, 1 sha-only is deleted
  // total kept = 1 prod + 10 sha = 11; total deleted = 1 sha
  assert.equal(result.keep.length, 11);
  assert.equal(result.delete.length, 1);

  // The deleted one must be a sha-only version (id 1, the oldest)
  assert.equal(result.delete[0].id, 1);
  assert.ok(!result.delete[0].metadata.container.tags.some((t) => t.startsWith('prod-')));
});

test('decide — unknown tags are kept with a warning', () => {
  const versions = [makeVersion(1, ['v1.2.3']), makeVersion(2, ['sha-abc1234'])];
  const result = decide(versions);
  const kept = result.keep.map((v) => v.id);
  assert.ok(kept.includes(1), 'unknown-tagged version should be kept');
  assert.equal(result.warnings.length, 1);
  assert.ok(result.warnings[0].includes('v1.2.3'));
});

test('decide — empty input returns empty keep/delete', () => {
  const result = decide([]);
  assert.equal(result.keep.length, 0);
  assert.equal(result.delete.length, 0);
  assert.equal(result.warnings.length, 0);
});

test('decide — version with both sha-* and prod-* does not appear in delete', () => {
  // Scenario from the outage: prod is running sha-e570cc1 which is about to age
  // out of the sha-* window. If prod-* tag is also applied, it must be kept.
  const versions = [
    makeVersion(1, ['sha-e570cc1', 'prod-20260521'], '2026-05-21T15:00:00Z'),
    ...Array.from({ length: 11 }, (_, i) =>
      makeVersion(i + 2, [`sha-${String(i + 2).padStart(7, 'b')}`], `2026-05-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
    ),
  ];
  const result = decide(versions);
  const deletedIds = result.delete.map((v) => v.id);
  assert.ok(!deletedIds.includes(1), 'prod-pinned version must never be deleted');
});

test('decide — latest-only version counts as sha slot', () => {
  const versions = [
    makeVersion(99, ['latest'], '2026-05-21T16:00:00Z'),
    ...Array.from({ length: 10 }, (_, i) =>
      makeVersion(i + 1, [`sha-${String(i + 1).padStart(7, 'c')}`], `2026-05-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
    ),
  ];
  // 11 total in sha pool (1 latest + 10 sha); keep 10 newest, delete 1 oldest
  const result = decide(versions);
  assert.equal(result.keep.length, 10);
  assert.equal(result.delete.length, 1);
  // id=99 (latest, newest) should be kept
  assert.ok(result.keep.some((v) => v.id === 99));
});
