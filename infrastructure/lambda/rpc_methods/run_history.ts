import { ScanCommand } from '@aws-sdk/lib-dynamodb'
import { RUNS_TABLE_NAME, TERMINAL_STATUSES, attachPerformance, ddb, publicRunView } from './shared'

export async function rpcRunHistory() {
  const resp = await ddb.send(new ScanCommand({
    TableName: RUNS_TABLE_NAME,
  }))

  const out: Record<string, any>[] = []
  for (const item of (resp.Items ?? []) as Record<string, any>[]) {
    if (typeof item.runId !== 'string' || item.runId.startsWith('RUNNER_LOCK#')) {
      continue
    }
    if (!TERMINAL_STATUSES.has(String(item.status))) {
      continue
    }
    const withPerformance = await attachPerformance(item)
    out.push(publicRunView(withPerformance))
  }

  out.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
  return { items: out }
}
