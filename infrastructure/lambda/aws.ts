import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { EC2Client } from '@aws-sdk/client-ec2'
import { SSMClient } from '@aws-sdk/client-ssm'
import { S3Client } from '@aws-sdk/client-s3'
import { SFNClient } from '@aws-sdk/client-sfn'

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
export const ec2 = new EC2Client({})
export const ssm = new SSMClient({})
export const s3 = new S3Client({})
export const sfn = new SFNClient({})
export const cloudwatch = new CloudWatchClient({})

export async function putMetric(metricName: string, value: number, runner?: string, benchmark?: string, unit: 'Count'|'Seconds'='Count') {
  const Dimensions = [
    runner ? { Name: 'Runner', Value: runner } : undefined,
    benchmark ? { Name: 'Benchmark', Value: benchmark } : undefined,
  ].filter(Boolean) as Array<{Name:string;Value:string}>
  try {
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: 'KernelBench/Runs',
      MetricData: [{ MetricName: metricName, Value: value, Unit: unit, Dimensions }],
    }))
  } catch {}
}
