import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { RUNS_TABLE_NAME, JsonRpcError, asObject, ddb, nowIso, publicRunView } from './shared'

function parseRunIds(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new JsonRpcError(-32602, 'runIds must be a non-empty array')
  }
  const runIds = value.map((runId) => {
    if (typeof runId !== 'string' || runId.length === 0) {
      throw new JsonRpcError(-32602, 'runIds must contain only non-empty strings')
    }
    return runId
  })
  if (new Set(runIds).size !== runIds.length) {
    throw new JsonRpcError(-32602, 'runIds must not contain duplicates')
  }
  return runIds
}

function priorityTimestamp(item: Record<string, any>) {
  return String(item.queuedAt ?? item.createdAt ?? nowIso())
}

function priorityDate(value: string) {
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? Date.now() : ms
}

export async function rpcReorderQueuedRuns(rawParams: unknown) {
  const params = asObject(rawParams)
  const runIds = parseRunIds(params.runIds)
  const foundItems: Record<string, any>[] = []

  for (const runId of runIds) {
    const found = await ddb.send(new GetCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId },
    }))
    const item = found.Item as Record<string, any> | undefined
    if (!item) {
      throw new JsonRpcError(-32004, 'run not found', { runId })
    }
    if (item.status !== 'QUEUED') {
      throw new JsonRpcError(-32011, 'only queued runs can be reordered', { runId, status: item.status })
    }
    foundItems.push(item)
  }
  const runners = new Set(foundItems.map((item) => item.runner))
  if (runners.size !== 1) {
    throw new JsonRpcError(-32012, 'queued runs must belong to the same runner queue', { runIds })
  }

  const firstQueuedAt = foundItems
    .map(priorityTimestamp)
    .sort((a, b) => a.localeCompare(b))[0] ?? nowIso()
  const baseMs = priorityDate(firstQueuedAt)
  const updatedAt = nowIso()
  const updatedItems: Record<string, any>[] = []

  for (const [index, runId] of runIds.entries()) {
    const item = foundItems.find((candidate) => candidate.runId === runId)!
    const queuedAt = new Date(baseMs + index).toISOString()
    await ddb.send(new UpdateCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId },
      UpdateExpression: 'SET queuedAt = :queuedAt, queuePriority = :priority, updatedAt = :updatedAt',
      ConditionExpression: '#status = :queued',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':queuedAt': queuedAt,
        ':priority': index + 1,
        ':updatedAt': updatedAt,
        ':queued': 'QUEUED',
      },
    }))
    updatedItems.push({ ...item, queuedAt, queuePriority: index + 1, updatedAt })
  }

  return { ok: true, items: updatedItems.map(publicRunView) }
}
