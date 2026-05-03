import { ScanCommand } from '@aws-sdk/lib-dynamodb'
import { RUNS_TABLE_NAME, ddb, reconcileRunningItem, TERMINAL_STATUSES, publicRunView } from './shared'

export async function rpcInProgressRuns() {
  const resp = await ddb.send(new ScanCommand({
    TableName: RUNS_TABLE_NAME,
    FilterExpression: '#status IN (:queued, :starting, :running)',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':queued': 'QUEUED', ':starting': 'STARTING', ':running': 'RUNNING' },
  }))

  const out: Record<string, any>[] = []
  for (const item of (resp.Items ?? []) as Record<string, any>[]) {
    const reconciled = await reconcileRunningItem(item)
    if (!TERMINAL_STATUSES.has(reconciled.status)) {
      out.push(publicRunView(reconciled))
    }
  }
  out.sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
  return { items: out }
}
