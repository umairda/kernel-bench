import { ScanCommand } from '@aws-sdk/lib-dynamodb'
import { RUNS_TABLE_NAME, ddb, reconcileRunningItem, TERMINAL_STATUSES, publicRunView } from './shared'

export async function rpcInProgressRuns() {
  const resp = await ddb.send(new ScanCommand({
    TableName: RUNS_TABLE_NAME,
    FilterExpression: '#status IN (:starting, :running)',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':starting': 'STARTING', ':running': 'RUNNING' },
  }))

  const out: Record<string, any>[] = []
  for (const item of (resp.Items ?? []) as Record<string, any>[]) {
    const reconciled = await reconcileRunningItem(item)
    if (!TERMINAL_STATUSES.has(reconciled.status)) {
      out.push(publicRunView(reconciled))
    }
  }
  out.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
  return { items: out }
}
