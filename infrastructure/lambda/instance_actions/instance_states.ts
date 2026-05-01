import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { DescribeInstancesCommand } from '@aws-sdk/client-ec2'
import { ec2 } from '../aws'
import { isOriginVerified, response } from '../common'

const CPU_INSTANCE_ID = process.env.CPU_INSTANCE_ID!
const GPU_INSTANCE_ID = process.env.GPU_INSTANCE_ID!

async function getState(instanceId: string) {
  const resp = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }))
  return resp.Reservations?.[0]?.Instances?.[0]?.State?.Name ?? 'unknown'
}

export async function handler(event: APIGatewayProxyEventV2) {
  if (!isOriginVerified(event)) return response(403, { error: 'origin not allowed' })
  try {
    const [cpu, gpu] = await Promise.all([getState(CPU_INSTANCE_ID), getState(GPU_INSTANCE_ID)])
    return response(200, { cpu, gpu })
  } catch (e: any) {
    return response(500, { error: String(e?.message ?? e) })
  }
}
