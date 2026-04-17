#!/usr/bin/env -S node --import tsx

const { execFile } = require('node:child_process') as typeof import('node:child_process')
const { promisify } = require('node:util') as typeof import('node:util')

const execFileAsync = promisify(execFile)

const defaultIntervalSeconds = 20
const defaultTimeoutSeconds = 900
const defaultReviewer = 'copilot-pull-request-reviewer[bot]'
const successExitCode = 0
const workNeededExitCode = 10
const errorExitCode = 1
const timeoutExitCode = 124

type Transport = 'gh' | 'api'

interface CliOptions {
  pullNumber: number
  repoSlug?: string
  intervalSeconds: number
  timeoutSeconds: number
  reviewer: string
  transport: 'auto' | Transport
}

interface PullRequestSnapshot {
  number: number
  state: string
  isDraft: boolean
  headRefOid: string
  reviews: Array<{
    state: string
    author: { login: string } | null
    commit: { oid: string } | null
    submittedAt: string | null
  }>
  reviewThreads: Array<{
    isResolved: boolean
    isOutdated: boolean
    comments: Array<{
      author: { login: string } | null
      body: string
      url: string
    }>
  }>
}

interface ReviewStatus {
  kind: 'success' | 'work-needed' | 'waiting' | 'error'
  message: string
}

const pullRequestQuery = `
  query($owner: String!, $repo: String!, $pullNumber: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pullNumber) {
        number
        state
        isDraft
        headRefOid
        reviews(last: 100) {
          nodes {
            state
            submittedAt
            author {
              login
            }
            commit {
              oid
            }
          }
        }
        reviewThreads(first: 100) {
          nodes {
            isResolved
            isOutdated
            comments(first: 20) {
              nodes {
                body
                url
                author {
                  login
                }
              }
            }
          }
        }
      }
    }
  }
`

function usage(): void {
  console.log(`Usage: scripts/wait-copilot-review.ts --pr <number> [options]

Waits for Copilot review on the current head SHA of a pull request.

Exit codes:
  0    Copilot reviewed the current head SHA and left no active threads
  10   Copilot reviewed the current head SHA and active threads remain
  124  Timed out waiting for Copilot to review the current head SHA
  1    Configuration, auth, API, or PR state error

Options:
  --pr <number>        Pull request number to watch (required)
  --repo <owner/name>  Override the repo slug. Defaults to origin remote.
  --interval <secs>    Poll interval in seconds (default: ${defaultIntervalSeconds})
  --timeout <secs>     Timeout in seconds (default: ${defaultTimeoutSeconds})
  --reviewer <login>   Reviewer login to watch (default: ${defaultReviewer})
  --transport <mode>   auto | gh | api (default: auto)
  --help               Show this help

Authentication:
  - If gh is installed and authenticated, the script prefers gh.
  - Otherwise it falls back to the GitHub GraphQL API using GH_TOKEN or GITHUB_TOKEN.
`)
}

function fail(message: string, exitCode = errorExitCode): never {
  console.error(message)
  process.exit(exitCode)
}

function parsePositiveInteger(rawValue: string, optionName: string): number {
  const value = Number.parseInt(rawValue, 10)

  if (!Number.isFinite(value) || value <= 0) {
    fail(`Invalid value for ${optionName}: ${rawValue}`)
  }

  return value
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    intervalSeconds: defaultIntervalSeconds,
    timeoutSeconds: defaultTimeoutSeconds,
    reviewer: defaultReviewer,
    transport: 'auto',
    pullNumber: Number.NaN,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]

    switch (argument) {
      case '--pr':
        index += 1
        if (index >= argv.length) {
          fail('Missing value for --pr')
        }
        options.pullNumber = parsePositiveInteger(argv[index], '--pr')
        break
      case '--repo':
        index += 1
        if (index >= argv.length) {
          fail('Missing value for --repo')
        }
        options.repoSlug = argv[index]
        break
      case '--interval':
        index += 1
        if (index >= argv.length) {
          fail('Missing value for --interval')
        }
        options.intervalSeconds = parsePositiveInteger(argv[index], '--interval')
        break
      case '--timeout':
        index += 1
        if (index >= argv.length) {
          fail('Missing value for --timeout')
        }
        options.timeoutSeconds = parsePositiveInteger(argv[index], '--timeout')
        break
      case '--reviewer':
        index += 1
        if (index >= argv.length) {
          fail('Missing value for --reviewer')
        }
        options.reviewer = argv[index]
        break
      case '--transport':
        index += 1
        if (index >= argv.length) {
          fail('Missing value for --transport')
        }
        if (argv[index] !== 'auto' && argv[index] !== 'gh' && argv[index] !== 'api') {
          fail(`Invalid value for --transport: ${argv[index]}`)
        }
        options.transport = argv[index]
        break
      case '--help':
      case '-h':
        usage()
        process.exit(successExitCode)
      default:
        fail(`Unknown argument: ${argument}`)
    }
  }

  if (!Number.isInteger(options.pullNumber)) {
    fail('Missing required option: --pr')
  }

  return options
}

async function runCommand(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
}

async function commandSucceeds(command: string, args: string[]): Promise<boolean> {
  try {
    await runCommand(command, args)
    return true
  } catch {
    return false
  }
}

function parseRepoSlug(remoteUrl: string): string | null {
  const sshMatch = remoteUrl.match(/^[^@]+@github\.com:(.+?)(?:\.git)?$/)
  if (sshMatch) {
    return sshMatch[1]
  }

  const sshUrlMatch = remoteUrl.match(/^ssh:\/\/[^@]+@github\.com\/(.+?)(?:\.git)?$/)
  if (sshUrlMatch) {
    return sshUrlMatch[1]
  }

  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?$/)
  if (httpsMatch) {
    return httpsMatch[1]
  }

  return null
}

async function resolveRepoSlug(explicitRepoSlug?: string): Promise<string> {
  if (explicitRepoSlug) {
    return explicitRepoSlug
  }

  const { stdout } = await runCommand('git', ['remote', 'get-url', 'origin'])
  const repoSlug = parseRepoSlug(stdout.trim())

  if (!repoSlug) {
    fail(`Could not infer a GitHub repo slug from origin: ${stdout.trim()}`)
  }

  return repoSlug
}

function splitRepoSlug(repoSlug: string): { owner: string; repo: string } {
  const segments = repoSlug.split('/')

  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    fail(`Invalid repo slug: ${repoSlug}`)
  }

  return { owner: segments[0], repo: segments[1] }
}

async function resolveTransport(
  requestedTransport: CliOptions['transport'],
): Promise<Transport> {
  if (requestedTransport === 'gh') {
    if (!(await commandSucceeds('gh', ['auth', 'status', '--hostname', 'github.com']))) {
      fail('Requested --transport gh, but gh is missing or not authenticated')
    }

    return 'gh'
  }

  if (requestedTransport === 'api') {
    if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
      fail('Requested --transport api, but GH_TOKEN or GITHUB_TOKEN is not set')
    }

    return 'api'
  }

  if (await commandSucceeds('gh', ['auth', 'status', '--hostname', 'github.com'])) {
    return 'gh'
  }

  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
    return 'api'
  }

  fail('No GitHub auth available. Install/authenticate gh or set GH_TOKEN/GITHUB_TOKEN.')
}

async function fetchSnapshotWithGh(
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestSnapshot> {
  const { stdout } = await runCommand('gh', [
    'api',
    'graphql',
    '-f',
    `owner=${owner}`,
    '-f',
    `repo=${repo}`,
    '-F',
    `pullNumber=${pullNumber}`,
    '-f',
    `query=${pullRequestQuery}`,
  ])

  return parseSnapshotResponse(stdout)
}

async function fetchSnapshotWithApi(
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestSnapshot> {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  if (!token) {
    fail('GH_TOKEN or GITHUB_TOKEN is required for API transport')
  }

  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'dnd-notes-copilot-review-waiter',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      query: pullRequestQuery,
      variables: { owner, repo, pullNumber },
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    fail(`GitHub GraphQL request failed (${response.status}): ${body}`)
  }

  return parseSnapshotResponse(await response.text())
}

function parseSnapshotResponse(responseText: string): PullRequestSnapshot {
  const payload = JSON.parse(responseText) as {
    errors?: Array<{ message?: string }>
    data?: {
      repository?: {
        pullRequest?: {
          number: number
          state: string
          isDraft: boolean
          headRefOid: string
          reviews?: {
            nodes?: PullRequestSnapshot['reviews']
          }
          reviewThreads?: {
            nodes?: Array<{
              isResolved: boolean
              isOutdated: boolean
              comments?: {
                nodes?: PullRequestSnapshot['reviewThreads'][number]['comments']
              }
            }>
          }
        }
      }
    }
  }

  if (payload.errors && payload.errors.length > 0) {
    const errorMessages = payload.errors
      .map((error) => error.message ?? 'Unknown GraphQL error')
      .join('; ')
    fail(`GitHub GraphQL error: ${errorMessages}`)
  }

  const pullRequest = payload.data?.repository?.pullRequest
  if (!pullRequest) {
    fail('Pull request not found in GitHub response')
  }

  return {
    number: pullRequest.number,
    state: pullRequest.state,
    isDraft: pullRequest.isDraft,
    headRefOid: pullRequest.headRefOid,
    reviews: pullRequest.reviews?.nodes ?? [],
    reviewThreads:
      pullRequest.reviewThreads?.nodes?.map((thread) => ({
        isResolved: thread.isResolved,
        isOutdated: thread.isOutdated,
        comments: thread.comments?.nodes ?? [],
      })) ?? [],
  }
}

function evaluateReviewStatus(
  snapshot: PullRequestSnapshot,
  reviewer: string,
): ReviewStatus {
  if (snapshot.state !== 'OPEN') {
    return {
      kind: 'error',
      message: `PR #${snapshot.number} is not open (state: ${snapshot.state})`,
    }
  }

  if (snapshot.isDraft) {
    return {
      kind: 'error',
      message: `PR #${snapshot.number} is still a draft`,
    }
  }

  const freshReviews = snapshot.reviews.filter(
    (review) =>
      review.author?.login === reviewer &&
      review.commit?.oid === snapshot.headRefOid &&
      review.state !== 'DISMISSED',
  )

  if (freshReviews.length === 0) {
    return {
      kind: 'waiting',
      message: `Waiting for ${reviewer} to review PR #${snapshot.number} on ${snapshot.headRefOid.slice(0, 12)}`,
    }
  }

  const activeThreads = snapshot.reviewThreads.filter((thread) => {
    if (thread.isResolved || thread.isOutdated) {
      return false
    }

    return thread.comments.some((comment) => comment.author?.login === reviewer)
  })

  if (activeThreads.length > 0) {
    return {
      kind: 'work-needed',
      message: `${reviewer} reviewed PR #${snapshot.number} on ${snapshot.headRefOid.slice(0, 12)} and left ${activeThreads.length} active thread(s)`,
    }
  }

  return {
    kind: 'success',
    message: `${reviewer} cleared PR #${snapshot.number} on ${snapshot.headRefOid.slice(0, 12)} with no active threads`,
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

async function fetchSnapshot(
  transport: Transport,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestSnapshot> {
  if (transport === 'gh') {
    return fetchSnapshotWithGh(owner, repo, pullNumber)
  }

  return fetchSnapshotWithApi(owner, repo, pullNumber)
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const repoSlug = await resolveRepoSlug(options.repoSlug)
  const { owner, repo } = splitRepoSlug(repoSlug)
  const transport = await resolveTransport(options.transport)
  const deadline = Date.now() + options.timeoutSeconds * 1000
  let lastMessage = ''

  while (Date.now() <= deadline) {
    const snapshot = await fetchSnapshot(transport, owner, repo, options.pullNumber)
    const status = evaluateReviewStatus(snapshot, options.reviewer)

    if (status.message !== lastMessage) {
      console.error(status.message)
      lastMessage = status.message
    }

    if (status.kind === 'success') {
      process.exit(successExitCode)
    }

    if (status.kind === 'work-needed') {
      process.exit(workNeededExitCode)
    }

    if (status.kind === 'error') {
      process.exit(errorExitCode)
    }

    const remainingMilliseconds = deadline - Date.now()
    if (remainingMilliseconds <= 0) {
      break
    }

    await sleep(Math.min(options.intervalSeconds * 1000, remainingMilliseconds))
  }

  fail(
    `Timed out after ${options.timeoutSeconds}s waiting for ${options.reviewer} on PR #${options.pullNumber}`,
    timeoutExitCode,
  )
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  fail(message)
})
