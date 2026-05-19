/**
 * Lightweight Prometheus-compatible metrics for the activator.
 *
 * Implements the Prometheus text exposition format (v0.0.4) without any
 * external dependency. Avoids prom-client to keep the activator's dep tree
 * minimal (prom-client is not installed in this monorepo).
 *
 * Exposed at GET /metrics in the Prometheus text format.
 *
 * Counters:
 *   activator_wake_total{tenant}          - number of cold-start wake attempts
 *   activator_error_total{tenant,reason}  - wake or proxy errors
 *   pod_schedule_deadline_exceeded_total{tenant}
 *
 * Histograms:
 *   activator_cold_start_duration_seconds{tenant} - end-to-end cold-start wall time
 *
 * Gauges:
 *   activator_held_connections            - connections currently held during cold-start
 */

/** Prometheus content type for text format */
export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8'

type Labels = Record<string, string>

function labelString(labels: Labels): string {
  const pairs = Object.entries(labels)
    .map(([k, v]) => `${k}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
    .join(',')
  return pairs ? `{${pairs}}` : ''
}

class Counter {
  private values = new Map<string, number>()

  constructor(readonly name: string, readonly help: string) {}

  inc(labels: Labels = {}): void {
    const key = JSON.stringify(labels)
    this.values.set(key, (this.values.get(key) ?? 0) + 1)
  }

  serialize(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ]
    for (const [key, value] of this.values.entries()) {
      const labels = JSON.parse(key) as Labels
      lines.push(`${this.name}${labelString(labels)} ${value}`)
    }
    return lines.join('\n')
  }
}

class Gauge {
  private value = 0

  constructor(readonly name: string, readonly help: string) {}

  inc(): void { this.value++ }
  dec(): void { this.value-- }
  set(v: number): void { this.value = v }

  serialize(): string {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
      `${this.name} ${this.value}`,
    ].join('\n')
  }
}

// Histogram bucket boundaries for cold-start durations (seconds)
const COLD_START_BUCKETS = [0.5, 1, 2, 3, 5, 8, 10, 15, 20, 30, 45, 60]

class Histogram {
  private bucketCounts: Map<string, Map<number, number>> = new Map()
  private sums: Map<string, number> = new Map()
  private counts: Map<string, number> = new Map()

  constructor(readonly name: string, readonly help: string, readonly buckets: number[]) {}

  observe(labels: Labels, value: number): void {
    const key = JSON.stringify(labels)
    if (!this.bucketCounts.has(key)) {
      this.bucketCounts.set(key, new Map(this.buckets.map((b) => [b, 0])))
    }
    const bc = this.bucketCounts.get(key)!
    for (const b of this.buckets) {
      if (value <= b) {
        bc.set(b, (bc.get(b) ?? 0) + 1)
      }
    }
    this.sums.set(key, (this.sums.get(key) ?? 0) + value)
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1)
  }

  serialize(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ]
    for (const [key, bc] of this.bucketCounts.entries()) {
      const labels = JSON.parse(key) as Labels
      for (const [bound, count] of bc.entries()) {
        lines.push(`${this.name}_bucket{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')},le="${bound}"} ${count}`)
      }
      const lstr = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')
      lines.push(`${this.name}_bucket{${lstr},le="+Inf"} ${this.counts.get(key) ?? 0}`)
      lines.push(`${this.name}_sum${labelString(labels)} ${this.sums.get(key) ?? 0}`)
      lines.push(`${this.name}_count${labelString(labels)} ${this.counts.get(key) ?? 0}`)
    }
    return lines.join('\n')
  }
}

export function createMetrics() {
  const wakeTotal = new Counter(
    'activator_wake_total',
    'Number of cold-start wake attempts per tenant',
  )

  const errorTotal = new Counter(
    'activator_error_total',
    'Number of wake or proxy errors per tenant and reason',
  )

  const coldStartDuration = new Histogram(
    'activator_cold_start_duration_seconds',
    'End-to-end cold-start wall time in seconds',
    COLD_START_BUCKETS,
  )

  const heldConnections = new Gauge(
    'activator_held_connections',
    'Number of client connections currently held during cold-start',
  )

  const podScheduleDeadlineExceeded = new Counter(
    'pod_schedule_deadline_exceeded_total',
    'Number of times a tenant pod stayed Pending past the scheduling budget',
  )

  function metrics(): string {
    return [
      wakeTotal.serialize(),
      errorTotal.serialize(),
      coldStartDuration.serialize(),
      heldConnections.serialize(),
      podScheduleDeadlineExceeded.serialize(),
    ].join('\n') + '\n'
  }

  return {
    metrics,
    contentType: METRICS_CONTENT_TYPE,
    wakeTotal,
    errorTotal,
    coldStartDuration,
    heldConnections,
    podScheduleDeadlineExceeded,
  }
}

export type ActivatorMetrics = ReturnType<typeof createMetrics>
