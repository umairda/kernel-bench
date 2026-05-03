import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as path from 'path';

export interface KernelBenchStackProps extends cdk.StackProps {
  sshCidr: string;
  cpuInstanceType: string;
  gpuInstanceType: string;
  gpuAmiId?: string;
  sourceArchiveKey: string;
}

export class KernelBenchStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: KernelBenchStackProps) {
    super(scope, id, props);

    const account = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;
    const ssmOutputLogGroup = new logs.LogGroup(this, 'KernelBench-SsmOutputLogGroup', {
      logGroupName: '/kernelbench/ssm-output',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const originVerifySecret = new cdk.CfnParameter(this, 'KernelBench-OriginVerifySecret', {
      type: 'String',
      noEcho: true,
      default: 'KernelBench-ChangeMe',
      description: 'Shared secret header value CloudFront sends to API origin.',
    });
    const githubRepo = new cdk.CfnParameter(this, 'KernelBench-GitHubRepo', {
      type: 'String',
      default: 'owner/repo',
      description: 'GitHub repository in owner/repo format allowed to assume the deploy role.',
    });
    const githubBranch = new cdk.CfnParameter(this, 'KernelBench-GitHubBranch', {
      type: 'String',
      default: 'main',
      description: 'Git branch allowed to assume the deploy role.',
    });
    const cloudFrontDomainName = new cdk.CfnParameter(this, 'KernelBench-CloudFrontDomainName', {
      type: 'String',
      default: '',
      description: 'Optional custom domain name for CloudFront (for example: kernel-bench.com).',
    });

    const githubOidcProviderArn = `arn:aws:iam::${account}:oidc-provider/token.actions.githubusercontent.com`;
    const githubOidcProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'KernelBench-GitHubOidcProvider',
      githubOidcProviderArn,
    );

    const githubActionsDeployRole = new iam.Role(this, 'KernelBench-GithubActionsDeployRole', {
      roleName: `KernelBench-GithubActionsDeployRole-${region}`,
      assumedBy: new iam.FederatedPrincipal(
        githubOidcProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': `repo:${githubRepo.valueAsString}:ref:refs/heads/${githubBranch.valueAsString}`,
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
      description: 'OIDC role for GitHub Actions to deploy KernelBench infrastructure and frontend assets.',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
      ],
    });

    const vpc = new ec2.Vpc(this, 'KernelBench-Vpc', {
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: 'KernelBench-Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    const normalizedBucketName = `kernelbench-artifacts-${account}-${region}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 63);

    const artifactBucket = new s3.Bucket(this, 'KernelBench-ArtifactBucket', {
      bucketName: normalizedBucketName,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const frontendBucket = new s3.Bucket(this, 'KernelBench-FrontendBucket', {
      bucketName: `kernelbench-frontend-${account}-${region}`.toLowerCase().slice(0, 63),
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const runsTable = new dynamodb.Table(this, 'KernelBench-RunsTable', {
      tableName: `KernelBench-Runs-${region}`,
      partitionKey: { name: 'runId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    runsTable.addGlobalSecondaryIndex({
      indexName: 'commandId-index',
      partitionKey: { name: 'commandId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const historyTable = new dynamodb.Table(this, 'KernelBench-HistoryTable', {
      tableName: `KernelBench-History-${region}`,
      partitionKey: { name: 'seriesKey', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'completedAtRunId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const runnerRole = new iam.Role(this, 'KernelBench-RunnerRole', {
      roleName: `KernelBench-RunnerRole-${region}`,
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });
    const runnerInstanceProfile = new iam.CfnInstanceProfile(this, 'KernelBench-RunnerInstanceProfile', {
      instanceProfileName: `KernelBench-RunnerInstanceProfile-${region}`,
      roles: [runnerRole.roleName],
    });
    artifactBucket.grantReadWrite(runnerRole);
    runnerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      }),
    );
    runnerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ec2:StopInstances'],
        resources: ['*'],
      }),
    );

    const sg = new ec2.SecurityGroup(this, 'KernelBench-InstanceSg', {
      securityGroupName: `KernelBench-InstanceSg-${region}`,
      vpc,
      description: 'KernelBench runner access',
      allowAllOutbound: true,
    });
    sg.addIngressRule(ec2.Peer.ipv4(props.sshCidr), ec2.Port.tcp(22), 'Optional SSH access');

    const machineImage = ec2.MachineImage.latestAmazonLinux2023({
      cpuType: ec2.AmazonLinuxCpuType.X86_64,
    });
    const gpuMachineImage = props.gpuAmiId
      ? ec2.MachineImage.genericLinux({ [region]: props.gpuAmiId })
      : ec2.MachineImage.lookup({
        name: 'Deep Learning Base AMI with Single CUDA (Ubuntu 24.04)*',
        owners: ['amazon'],
        filters: {
          architecture: ['x86_64'],
          'root-device-type': ['ebs'],
          'virtualization-type': ['hvm'],
        },
      });

    const cpuRunner = this.createRunner({
      idPrefix: 'KernelBench-CpuRunner',
      instanceName: 'KernelBench-cpu-runner',
      instanceType: props.cpuInstanceType,
      role: runnerRole,
      vpc,
      sg,
      machineImage,
      installGpuDrivers: false,
    });

    const gpuRunner = this.createRunner({
      idPrefix: 'KernelBench-GpuRunner',
      instanceName: 'KernelBench-gpu-runner',
      instanceType: props.gpuInstanceType,
      role: runnerRole,
      vpc,
      sg,
      machineImage: gpuMachineImage,
      installGpuDrivers: false,
      assumePreparedImage: true,
    });

    const stopOnCreate = new cr.AwsCustomResource(this, 'KernelBench-StopDefaultInstances', {
      onCreate: {
        service: 'EC2',
        action: 'stopInstances',
        parameters: {
          InstanceIds: [cpuRunner.instanceId, gpuRunner.instanceId],
        },
        physicalResourceId: cr.PhysicalResourceId.of(`KernelBench-stop-default-${Date.now()}`),
      },
      onUpdate: {
        service: 'EC2',
        action: 'stopInstances',
        parameters: {
          InstanceIds: [cpuRunner.instanceId, gpuRunner.instanceId],
        },
        physicalResourceId: cr.PhysicalResourceId.of(`KernelBench-stop-update-${Date.now()}`),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE }),
      installLatestAwsSdk: false,
      timeout: cdk.Duration.minutes(5),
    });
    stopOnCreate.node.addDependency(cpuRunner);
    stopOnCreate.node.addDependency(gpuRunner);

    const runWorkflowStepFn = new lambdaNodejs.NodejsFunction(this, 'KernelBench-RunWorkflowStepFn', {
      functionName: `KernelBench-run-workflow-step-${region}`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '..', 'lambda', 'instance_actions', 'run_workflow_step.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        RUNS_TABLE_NAME: runsTable.tableName,
        ARTIFACT_BUCKET_NAME: artifactBucket.bucketName,
        SOURCE_ARCHIVE_KEY: props.sourceArchiveKey,
        BASE_COMMAND_TIMEOUT_SECONDS: String(90 * 60),
        MAX_COMMAND_TIMEOUT_SECONDS: String(6 * 60 * 60),
        SSM_OUTPUT_LOG_GROUP: ssmOutputLogGroup.logGroupName,
      },
    });
    const sweepStaleRunsFn = new lambdaNodejs.NodejsFunction(this, 'KernelBench-SweepStaleRunsFn', {
      functionName: `KernelBench-sweep-stale-runs-${region}`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '..', 'lambda', 'instance_actions', 'sweep_stale_runs.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        RUNS_TABLE_NAME: runsTable.tableName,
        RUN_STALE_MINUTES: '45',
        IDLE_INSTANCE_MINUTES: '10',
        CPU_INSTANCE_ID: cpuRunner.instanceId,
        GPU_INSTANCE_ID: gpuRunner.instanceId,
      },
    });

    const rpcFn = new lambdaNodejs.NodejsFunction(this, 'KernelBench-RpcFn', {
      functionName: `KernelBench-rpc-${region}`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '..', 'lambda', 'rpc_handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        RUNS_TABLE_NAME: runsTable.tableName,
        HISTORY_TABLE_NAME: historyTable.tableName,
        ARTIFACT_BUCKET_NAME: artifactBucket.bucketName,
        CPU_INSTANCE_ID: cpuRunner.instanceId,
        GPU_INSTANCE_ID: gpuRunner.instanceId,
        CPU_INSTANCE_TYPE: props.cpuInstanceType,
        GPU_INSTANCE_TYPE: props.gpuInstanceType,
        SOURCE_ARCHIVE_KEY: props.sourceArchiveKey,
        ORIGIN_VERIFY_SECRET: originVerifySecret.valueAsString,
        RUNNER_LOCK_TTL_SECONDS: '7200',
        STARTING_STALE_SECONDS: '900',
        SSM_OUTPUT_LOG_GROUP: ssmOutputLogGroup.logGroupName,
      },
    });

    runsTable.grantReadWriteData(runWorkflowStepFn);
    runsTable.grantReadWriteData(sweepStaleRunsFn);
    runsTable.grantReadWriteData(rpcFn);
    historyTable.grantReadWriteData(runWorkflowStepFn);
    historyTable.grantReadWriteData(rpcFn);
    artifactBucket.grantRead(rpcFn);

    runWorkflowStepFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ec2:DescribeInstances', 'ec2:DescribeInstanceStatus', 'ec2:StartInstances', 'ec2:StopInstances'],
        resources: ['*'],
      }),
    );
    runWorkflowStepFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:SendCommand', 'ssm:DescribeInstanceInformation', 'ssm:GetCommandInvocation'],
        resources: ['*'],
      }),
    );
    runWorkflowStepFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      }),
    );
    ssmOutputLogGroup.grantRead(runWorkflowStepFn);
    artifactBucket.grantRead(runWorkflowStepFn);

    rpcFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetCommandInvocation', 'ec2:StopInstances', 'ec2:DescribeInstances'],
        resources: ['*'],
      }),
    );
    rpcFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      }),
    );
    ssmOutputLogGroup.grantRead(rpcFn);
    sweepStaleRunsFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ec2:StopInstances', 'ec2:DescribeInstances', 'ssm:ListCommandInvocations'],
        resources: ['*'],
      }),
    );
    const startAndWaitTask = new sfnTasks.LambdaInvoke(this, 'KernelBench-StartAndWaitTask', {
      lambdaFunction: runWorkflowStepFn,
      payloadResponseOnly: true,
      payload: sfn.TaskInput.fromObject({
        'action': 'START_AND_WAIT',
        'runId.$': '$.runId',
        'runner.$': '$.runner',
        'instanceType.$': '$.instanceType',
        'benchmark.$': '$.benchmark',
        'params.$': '$.params',
        'instanceId.$': '$.instanceId',
        's3Prefix.$': '$.s3Prefix',
        'createdAt.$': '$.createdAt',
      }),
      resultPath: '$',
    });
    const dispatchTask = new sfnTasks.LambdaInvoke(this, 'KernelBench-DispatchTask', {
      lambdaFunction: runWorkflowStepFn,
      payloadResponseOnly: true,
      payload: sfn.TaskInput.fromObject({
        'action': 'DISPATCH',
        'runId.$': '$.runId',
        'runner.$': '$.runner',
        'instanceType.$': '$.instanceType',
        'benchmark.$': '$.benchmark',
        'params.$': '$.params',
        'instanceId.$': '$.instanceId',
        's3Prefix.$': '$.s3Prefix',
        'createdAt.$': '$.createdAt',
        'launchTiming.$': '$.launchTiming',
      }),
      resultPath: '$',
    });
    const pollTask = new sfnTasks.LambdaInvoke(this, 'KernelBench-PollTask', {
      lambdaFunction: runWorkflowStepFn,
      payloadResponseOnly: true,
      payload: sfn.TaskInput.fromObject({
        'action': 'POLL',
        'runId.$': '$.runId',
        'runner.$': '$.runner',
        'instanceType.$': '$.instanceType',
        'benchmark.$': '$.benchmark',
        'params.$': '$.params',
        'instanceId.$': '$.instanceId',
        's3Prefix.$': '$.s3Prefix',
        'createdAt.$': '$.createdAt',
        'commandId.$': '$.commandId',
      }),
      resultPath: '$',
    });
    const finalizeTask = new sfnTasks.LambdaInvoke(this, 'KernelBench-FinalizeTask', {
      lambdaFunction: runWorkflowStepFn,
      payloadResponseOnly: true,
      payload: sfn.TaskInput.fromObject({
        'action': 'FINALIZE',
        'runId.$': '$.runId',
        'runner.$': '$.runner',
        'instanceType.$': '$.instanceType',
        'benchmark.$': '$.benchmark',
        'params.$': '$.params',
        'instanceId.$': '$.instanceId',
        's3Prefix.$': '$.s3Prefix',
        'createdAt.$': '$.createdAt',
        'commandId.$': '$.commandId',
        'poll.$': '$.poll',
      }),
      resultPath: '$',
    });
    const waitForPoll = new sfn.Wait(this, 'KernelBench-WaitBeforeFirstPoll', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(15)),
    });
    const waitLoop = new sfn.Wait(this, 'KernelBench-WaitBeforeNextPoll', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(15)),
    });
    const choice = new sfn.Choice(this, 'KernelBench-IsTerminal');
    waitForPoll.next(pollTask);
    waitLoop.next(pollTask);
    pollTask.next(choice);
    choice
      .when(sfn.Condition.booleanEquals('$.poll.isTerminal', true), finalizeTask)
      .otherwise(waitLoop);

    const workflowDefinition = startAndWaitTask
      .next(dispatchTask)
      .next(waitForPoll);

    const runWorkflowStateMachine = new sfn.StateMachine(this, 'KernelBench-RunWorkflowStateMachine', {
      stateMachineName: `KernelBench-run-workflow-${region}`,
      definitionBody: sfn.DefinitionBody.fromChainable(workflowDefinition),
      timeout: cdk.Duration.hours(7),
    });

    rpcFn.addEnvironment('RUN_WORKFLOW_STATE_MACHINE_ARN', runWorkflowStateMachine.stateMachineArn);
    runWorkflowStateMachine.grantStartExecution(rpcFn);
    runWorkflowStateMachine.grantRead(rpcFn);
    rpcFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['states:StopExecution'],
        resources: [`arn:aws:states:${region}:${account}:execution:KernelBench-run-workflow-${region}:*`],
      }),
    );

    new events.Rule(this, 'KernelBench-StaleRunSweepRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(10)),
      targets: [new targets.LambdaFunction(sweepStaleRunsFn)],
    });

    const api = new apigwv2.HttpApi(this, 'KernelBench-RpcApi', {
      apiName: `KernelBench-RpcApi-${region}`,
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ['*'],
      },
    });

    api.addRoutes({
      path: '/api',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('KernelBench-RpcIntegration', rpcFn),
    });

    new s3deploy.BucketDeployment(this, 'KernelBench-FrontendPlaceholderDeploy', {
      destinationBucket: frontendBucket,
      sources: [s3deploy.Source.data('index.html', '<!doctype html><html><body><h1>KernelBench frontend not uploaded yet.</h1></body></html>')],
      prune: false,
    });

    const apiDomainName = cdk.Fn.select(2, cdk.Fn.split('/', api.apiEndpoint));
    const distribution = new cloudfront.Distribution(this, 'KernelBench-Distribution', {
      comment: 'KernelBench frontend + RPC API',
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        'api*': {
          origin: new origins.HttpOrigin(apiDomainName, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
            customHeaders: {
              'x-kernelbench-origin': originVerifySecret.valueAsString,
            },
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
    });
    const hasCustomCloudFrontDomain = new cdk.CfnCondition(this, 'KernelBench-HasCustomCloudFrontDomain', {
      expression: cdk.Fn.conditionNot(cdk.Fn.conditionEquals(cloudFrontDomainName.valueAsString, '')),
    });

    const hostedZoneLookup = new cr.AwsCustomResource(this, 'KernelBench-CloudFrontHostedZoneLookup', {
      onCreate: {
        service: 'Route53',
        action: 'listHostedZonesByName',
        parameters: {
          DNSName: cdk.Fn.join('', [cloudFrontDomainName.valueAsString, '.']),
          MaxItems: '1',
        },
        physicalResourceId: cr.PhysicalResourceId.of(`KernelBench-zone-lookup-${Date.now()}`),
      },
      onUpdate: {
        service: 'Route53',
        action: 'listHostedZonesByName',
        parameters: {
          DNSName: cdk.Fn.join('', [cloudFrontDomainName.valueAsString, '.']),
          MaxItems: '1',
        },
        physicalResourceId: cr.PhysicalResourceId.of(`KernelBench-zone-lookup-update-${Date.now()}`),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE }),
      installLatestAwsSdk: false,
      timeout: cdk.Duration.minutes(2),
    });
    const hostedZoneIdPath = hostedZoneLookup.getResponseField('HostedZones.0.Id')
    const hostedZoneId = cdk.Fn.select(2, cdk.Fn.split('/', hostedZoneIdPath))

    const customDomainCertificate = new acm.CfnCertificate(this, 'KernelBench-CloudFrontCertificate', {
      domainName: cloudFrontDomainName.valueAsString,
      validationMethod: 'DNS',
      domainValidationOptions: [
        {
          domainName: cloudFrontDomainName.valueAsString,
          hostedZoneId,
        },
      ],
    });
    customDomainCertificate.cfnOptions.condition = hasCustomCloudFrontDomain

    const cfnDistribution = distribution.node.defaultChild as cloudfront.CfnDistribution
    cfnDistribution.addPropertyOverride(
      'DistributionConfig.Aliases',
      cdk.Fn.conditionIf(
        hasCustomCloudFrontDomain.logicalId,
        [cloudFrontDomainName.valueAsString],
        cdk.Aws.NO_VALUE,
      ),
    )
    cfnDistribution.addPropertyOverride(
      'DistributionConfig.ViewerCertificate',
      cdk.Fn.conditionIf(
        hasCustomCloudFrontDomain.logicalId,
        {
          AcmCertificateArn: customDomainCertificate.ref,
          SslSupportMethod: 'sni-only',
          MinimumProtocolVersion: 'TLSv1.2_2021',
        },
        { CloudFrontDefaultCertificate: true },
      ),
    )
    const customDomainARecord = new route53.CfnRecordSet(this, 'KernelBench-CloudFrontARecord', {
      hostedZoneId,
      name: cloudFrontDomainName.valueAsString,
      type: 'A',
      aliasTarget: {
        dnsName: distribution.distributionDomainName,
        hostedZoneId: 'Z2FDTNDATAQYW2',
      },
    })
    customDomainARecord.cfnOptions.condition = hasCustomCloudFrontDomain

    const customDomainAaaaRecord = new route53.CfnRecordSet(this, 'KernelBench-CloudFrontAaaaRecord', {
      hostedZoneId,
      name: cloudFrontDomainName.valueAsString,
      type: 'AAAA',
      aliasTarget: {
        dnsName: distribution.distributionDomainName,
        hostedZoneId: 'Z2FDTNDATAQYW2',
      },
    })
    customDomainAaaaRecord.cfnOptions.condition = hasCustomCloudFrontDomain

    new cdk.CfnOutput(this, 'KernelBench-ApiBaseUrl', {
      value: api.url ?? 'unknown',
      description: 'RPC API base URL',
    });

    new cdk.CfnOutput(this, 'KernelBench-ArtifactBucketName', {
      value: artifactBucket.bucketName,
      description: 'S3 bucket containing source archives and benchmark outputs',
    });

    new cdk.CfnOutput(this, 'KernelBench-CpuInstanceId', {
      value: cpuRunner.instanceId,
      description: 'CPU benchmark runner EC2 instance ID',
    });

    new cdk.CfnOutput(this, 'KernelBench-GpuInstanceId', {
      value: gpuRunner.instanceId,
      description: 'GPU benchmark runner EC2 instance ID',
    });
    new cdk.CfnOutput(this, 'KernelBench-RunnerInstanceProfileName', {
      value: runnerInstanceProfile.ref,
      description: 'Instance profile name used by benchmark runner instances',
    });

    new cdk.CfnOutput(this, 'KernelBench-RunsTableName', {
      value: runsTable.tableName,
      description: 'DynamoDB table for benchmark run state',
    });

    new cdk.CfnOutput(this, 'KernelBench-HistoryTableName', {
      value: historyTable.tableName,
      description: 'DynamoDB table for historical benchmark chart data',
    });

    new cdk.CfnOutput(this, 'KernelBench-SourceArchiveKey', {
      value: props.sourceArchiveKey,
      description: 'S3 key expected for source archive uploads',
    });

    new cdk.CfnOutput(this, 'KernelBench-FrontendBucketName', {
      value: frontendBucket.bucketName,
      description: 'Private S3 bucket for frontend SPA assets',
    });

    new cdk.CfnOutput(this, 'KernelBench-CloudFrontDomain', {
      value: distribution.distributionDomainName,
      description: 'CloudFront domain serving frontend and /api API routes',
    });
    new cdk.CfnOutput(this, 'KernelBench-GithubActionsDeployRoleArn', {
      value: githubActionsDeployRole.roleArn,
      description: 'IAM role ARN for GitHub Actions OIDC deployments',
    });

    const cpuStatusFailed = new cloudwatch.Alarm(this, 'KernelBench-CpuStatusCheckFailedAlarm', {
      alarmName: `KernelBench-CpuStatusCheckFailed-${region}`,
      alarmDescription: 'CPU runner EC2 status check failed',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/EC2',
        metricName: 'StatusCheckFailed',
        dimensionsMap: { InstanceId: cpuRunner.instanceId },
        statistic: 'Maximum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    const gpuStatusFailed = new cloudwatch.Alarm(this, 'KernelBench-GpuStatusCheckFailedAlarm', {
      alarmName: `KernelBench-GpuStatusCheckFailed-${region}`,
      alarmDescription: 'GPU runner EC2 status check failed',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/EC2',
        metricName: 'StatusCheckFailed',
        dimensionsMap: { InstanceId: gpuRunner.instanceId },
        statistic: 'Maximum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    const runFailures = new cloudwatch.Alarm(this, 'KernelBench-RunFailuresAlarm', {
      alarmName: `KernelBench-RunFailures-${region}`,
      alarmDescription: 'One or more benchmark runs failed in the last 5 minutes',
      metric: new cloudwatch.Metric({
        namespace: 'KernelBench/Runs',
        metricName: 'RunFailed',
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    const dashboard = new cloudwatch.Dashboard(this, 'KernelBench-Dashboard', {
      dashboardName: `KernelBench-${region}`,
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'EC2 CPU Utilization',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/EC2',
            metricName: 'CPUUtilization',
            dimensionsMap: { InstanceId: cpuRunner.instanceId },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            label: 'CPU Runner',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/EC2',
            metricName: 'CPUUtilization',
            dimensionsMap: { InstanceId: gpuRunner.instanceId },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            label: 'GPU Runner',
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'Memory Used Percent (CWAgent)',
        left: [
          new cloudwatch.Metric({
            namespace: 'CWAgent',
            metricName: 'mem_used_percent',
            dimensionsMap: { InstanceId: cpuRunner.instanceId },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            label: 'CPU Runner',
          }),
          new cloudwatch.Metric({
            namespace: 'CWAgent',
            metricName: 'mem_used_percent',
            dimensionsMap: { InstanceId: gpuRunner.instanceId },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
            label: 'GPU Runner',
          }),
        ],
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Run Throughput',
        left: [
          new cloudwatch.Metric({
            namespace: 'KernelBench/Runs',
            metricName: 'RunStarted',
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
          new cloudwatch.Metric({
            namespace: 'KernelBench/Runs',
            metricName: 'RunCompleted',
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
          new cloudwatch.Metric({
            namespace: 'KernelBench/Runs',
            metricName: 'RunFailed',
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'Benchmark Duration (seconds)',
        left: [
          new cloudwatch.Metric({
            namespace: 'KernelBench/Runs',
            metricName: 'RunDurationSeconds',
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
      }),
    );

    new cdk.CfnOutput(this, 'KernelBench-CpuStatusAlarmName', {
      value: cpuStatusFailed.alarmName,
      description: 'CloudWatch alarm for CPU runner status checks',
    });

    new cdk.CfnOutput(this, 'KernelBench-GpuStatusAlarmName', {
      value: gpuStatusFailed.alarmName,
      description: 'CloudWatch alarm for GPU runner status checks',
    });

    new cdk.CfnOutput(this, 'KernelBench-RunFailuresAlarmName', {
      value: runFailures.alarmName,
      description: 'CloudWatch alarm for benchmark run failures',
    });

    new cdk.CfnOutput(this, 'KernelBench-DashboardName', {
      value: dashboard.dashboardName,
      description: 'CloudWatch dashboard for runner and benchmark metrics',
    });
  }

  private createRunner(args: {
    idPrefix: string;
    instanceName: string;
    instanceType: string;
    role: iam.Role;
    vpc: ec2.Vpc;
    sg: ec2.SecurityGroup;
    machineImage: ec2.IMachineImage;
    installGpuDrivers: boolean;
    assumePreparedImage?: boolean;
  }): ec2.Instance {
    const userData = ec2.UserData.forLinux();
    userData.addCommands('set -euxo pipefail');
    if (args.assumePreparedImage) {
      userData.addCommands(
        'if command -v dnf >/dev/null 2>&1; then',
        '  dnf install -y git cmake gcc gcc-c++ make tar gzip unzip jq awscli python3 amazon-cloudwatch-agent || true',
        'elif command -v apt-get >/dev/null 2>&1; then',
        '  DEBIAN_FRONTEND=noninteractive apt-get update -y',
        '  DEBIAN_FRONTEND=noninteractive apt-get install -y git cmake build-essential make tar gzip unzip jq awscli python3 || true',
        'fi',
        'mkdir -p /opt/kernel-bench',
        'RUNNER_USER="$(id -nu 1000 2>/dev/null || echo root)"',
        'RUNNER_GROUP="$(id -ng "${RUNNER_USER}" 2>/dev/null || echo root)"',
        'chown "${RUNNER_USER}:${RUNNER_GROUP}" /opt/kernel-bench || true',
      );
    } else {
      userData.addCommands(
        'dnf update -y',
        'dnf install -y git cmake gcc gcc-c++ make tar gzip unzip jq awscli python3 amazon-cloudwatch-agent',
        'mkdir -p /opt/kernel-bench',
        'chown ec2-user:ec2-user /opt/kernel-bench',
      );
    }
    userData.addCommands(
      'if [ -d /opt/aws/amazon-cloudwatch-agent/etc ]; then',
      "cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<'CWAGENT'",
      '{',
      '  "metrics": {',
      '    "append_dimensions": {',
      '      "InstanceId": "${aws:InstanceId}"',
      '    },',
      '    "metrics_collected": {',
      '      "mem": {',
      '        "measurement": [',
      '          "mem_used_percent"',
      '        ]',
      '      },',
      '      "disk": {',
      '        "measurement": [',
      '          "used_percent"',
      '        ],',
      '        "resources": [',
      '          "/"',
      '        ]',
      '      }',
      '    }',
      '  }',
      '}',
      'CWAGENT',
      '/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s || true',
      'fi',
    );

    if (args.installGpuDrivers && !args.assumePreparedImage) {
      userData.addCommands(
        '# Best-effort NVIDIA driver setup for GPU instances.',
        'DRIVER_PKG=""',
        'if dnf list --available nvidia-driver-latest-dkms >/dev/null 2>&1; then DRIVER_PKG="nvidia-driver-latest-dkms"; fi',
        'if [ -z "$DRIVER_PKG" ] && dnf list --available nvidia-driver >/dev/null 2>&1; then DRIVER_PKG="nvidia-driver"; fi',
        'if [ -z "$DRIVER_PKG" ] && dnf list --available kmod-nvidia-latest-dkms >/dev/null 2>&1; then DRIVER_PKG="kmod-nvidia-latest-dkms"; fi',
        'if [ -n "$DRIVER_PKG" ]; then dnf install -y "$DRIVER_PKG" || true; else echo "No NVIDIA driver package available in configured repos" >&2; fi',
      );
    }

    const instance = new ec2.Instance(this, `${args.idPrefix}-Instance`, {
      vpc: args.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceName: args.instanceName,
      securityGroup: args.sg,
      role: args.role,
      instanceType: new ec2.InstanceType(args.instanceType),
      machineImage: args.machineImage,
      userData,
      detailedMonitoring: true,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(80, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            deleteOnTermination: true,
            encrypted: true,
          }),
        },
      ],
    });
    cdk.Tags.of(instance).add('Project', 'KernelBench');
    cdk.Tags.of(instance).add('Role', 'benchmark-runner');

    return instance;
  }
}
