import { Construct } from "constructs";
import { App, TerraformStack,  Fn, TerraformAsset, TerraformOutput } from "cdktf";
import { Vpc} from "./.gen/modules/terraform-aws-modules/aws/vpc";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { EcsCluster } from "@cdktf/provider-aws/lib/ecs-cluster";
import { Resource } from "@cdktf/provider-null/lib/resource";
import { IamRole } from "@cdktf/provider-aws/lib/iam-role";
import { EcsTaskDefinition } from "@cdktf/provider-aws/lib/ecs-task-definition";
import { Rds } from "./.gen/modules/terraform-aws-modules/aws/rds";

import { SecurityGroup } from "@cdktf/provider-aws/lib/security-group";
import { Password } from "@cdktf/provider-random/lib/password";
import { Lb } from "@cdktf/provider-aws/lib/lb";
import { LbListener } from "@cdktf/provider-aws/lib/lb-listener";
import { EcsService } from "@cdktf/provider-aws/lib/ecs-service";
import { LbListenerRule } from "@cdktf/provider-aws/lib/lb-listener-rule";
import { LbTargetGroup } from "@cdktf/provider-aws/lib/lb-target-group";
import { EcrRepository } from "@cdktf/provider-aws/lib/ecr-repository";
import { DataAwsEcrAuthorizationToken } from "@cdktf/provider-aws/lib/data-aws-ecr-authorization-token";
import { CloudfrontDistribution } from "@cdktf/provider-aws/lib/cloudfront-distribution";
import path = require("path");
import { CloudwatchLogGroup } from "@cdktf/provider-aws/lib/cloudwatch-log-group";
import { NullProvider } from "@cdktf/provider-null/lib/provider";
import { RandomProvider } from "@cdktf/provider-random/lib/provider";

const BACKEND_ORIGIN_ID = "backendOrigin";

const REGION = "ap-southeast-2"; 
const PROJECT_NAME = "k6-test";
const tags = {
  projectName: PROJECT_NAME,
}

class Cluster extends Construct {
  public cluster: EcsCluster;
  constructor(scope: Construct, clusterName: string) {
    super(scope, clusterName);

    const cluster = new EcsCluster(this, `ecs-${clusterName}`, {
      name: clusterName,
      tags,
    });

    this.cluster = cluster;
  }

  public runDockerImage(
    name: string,
    image: Resource, 
    backendTag: string, 
    env: Record<string, string | undefined>
  ) {
    // Role that allows us to get the Docker image
    const executionRole = new IamRole(this, `execution-role`, {
      name: `${name}-execution-role`,
      tags,
      inlinePolicy: [
        {
          name: "allow-ecr-pull",
          policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: [
                  "ecr:GetAuthorizationToken",
                  "ecr:BatchCheckLayerAvailability",
                  "ecr:GetDownloadUrlForLayer",
                  "ecr:BatchGetImage",
                  "logs:CreateLogStream",
                  "logs:PutLogEvents",
                ],
                Resource: "*",
              },
            ],
          }),
        },
      ],
      // this role shall only be used by an ECS task
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Sid: "",
            Principal: {
              Service: "ecs-tasks.amazonaws.com",
            },
          },
        ],
      }),
    });

    // Role that allows us to push logs
    const taskRole = new IamRole(this, `task-role`, {
      name: `${name}-task-role`,
      tags,
      inlinePolicy: [
        {
          name: "allow-logs",
          policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
                Resource: "*",
              },
            ],
          }),
        },
      ],
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Sid: "",
            Principal: {
              Service: "ecs-tasks.amazonaws.com",
            },
          },
        ],
      }),
    });

        // Creates a log group for the task
        const logGroup = new CloudwatchLogGroup(this, `loggroup`, {
          name: `${this.cluster.name}/${name}`,
          retentionInDays: 30,
          tags,
        });



    const multiplier = 1; 

    // Creates a task that runs the docker container
    const task = new EcsTaskDefinition(this, `task`, {
      // We want to wait until the image is actually pushed
      dependsOn: [image],
      tags,
      // These values are fixed for the example, we can make them part of our function invocation if we want to change them
      cpu: `${256 * multiplier}`,
      memory: `${512 * multiplier}`,
      requiresCompatibilities: ["FARGATE", "EC2"],
      networkMode: "awsvpc",
      executionRoleArn: executionRole.arn,
      taskRoleArn: taskRole.arn,
      

      containerDefinitions: JSON.stringify([
        {
          name,
          image: backendTag,
          cpu: 256 * multiplier,
          memory: 512 * multiplier,
          environment: Object.entries(env).map(([name, value]) => ({
            name,
            value,
          })),
          portMappings: [
            {
              containerPort: 80,
              hostPort: 80,
            },
          ],
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              // Defines the log
              "awslogs-group": logGroup.name,
              "awslogs-region": REGION,
              "awslogs-stream-prefix": name,
            },
          },
        },
      ]),
      family: "service",
    });

    return task;
  }
}

class LoadBalancer extends Construct {
  lb: Lb;
  lbl: LbListener;
  vpc: Vpc;
  cluster: EcsCluster;

  constructor(scope: Construct, name: string, vpc: Vpc, cluster: EcsCluster) {
    super(scope, name);
    this.vpc = vpc;
    this.cluster = cluster;


    const lbSecurityGroup = new SecurityGroup(
      scope,
      `lb-security-group`,
      {
        vpcId: vpc.vpcIdOutput,
        tags,
        ingress: [
          // allow HTTP traffic from everywhere
          {
            protocol: "TCP",
            fromPort: 80,
            toPort: 80,
            cidrBlocks: ["0.0.0.0/0"],
            ipv6CidrBlocks: ["::/0"],
          },
        ],
        egress: [
          // allow all traffic to every destination
          {
            fromPort: 0,
            toPort: 0,
            protocol: "-1",
            cidrBlocks: ["0.0.0.0/0"],
            ipv6CidrBlocks: ["::/0"],
          },
        ],
      }
    );

    this.lb = new Lb(scope, `lb`, {
      name: `${name}-lb`,
      tags,
      // we want this to be our public load balancer so that cloudfront can access it
      internal: false,
      loadBalancerType: "application",
      securityGroups: [lbSecurityGroup.id],
      subnets: Fn.tolist(vpc.publicSubnetsOutput),
    });

    this.lbl = new LbListener(scope, `lb-listener`, {
      loadBalancerArn: this.lb.arn,
      port: 80,
      protocol: "HTTP",
      tags,
      defaultAction: [
        // We define a fixed 404 message, just in case
        {
          type: "fixed-response",
          fixedResponse:             {
              contentType: "text/plain",
              statusCode: "404",
              messageBody: "Could not find the resource you are looking for",
            },
          
        },
      ],
    });
  }


  exposeService(
    name: string,
    task: EcsTaskDefinition,
    serviceSecurityGroup: SecurityGroup, 
    path: string, 
  ) {
    const targetGroup = new LbTargetGroup(this, `target-group`, {
      dependsOn: [this.lbl],
      tags,
      name: `${name}-target-group`,
      port: 80,
      protocol: "HTTP",
      targetType: "ip",
      vpcId: Fn.tostring(this.vpc.vpcIdOutput),
      healthCheck: {
        enabled: true,
        path: "/ready",
      },
    });

    // Makes the listener forward requests from subpath to the target group
    new LbListenerRule(this, `rule`, {
      listenerArn: this.lbl.arn,
      priority: 100,
      tags,
      action: [
        {
          type: "forward",
          targetGroupArn: targetGroup.arn,
        },
      ],

      condition: [
        {
          pathPattern: { values: [`${path}*`] },
        },
      ],
    });

    // Ensure the task is running and wired to the target group, within the right security group
    const ecs = new EcsService(this, `service`, {
      dependsOn: [this.lbl],
      tags,
      name: `${name}-service`,
      launchType: "FARGATE",
      cluster: this.cluster.id,
      desiredCount: 1,
      taskDefinition: task.arn,
      networkConfiguration: {
        subnets: Fn.tolist(this.vpc.publicSubnetsOutput),
        assignPublicIp: true,
        securityGroups: [serviceSecurityGroup.id],
      },
      loadBalancer: [
        {
          containerPort: 80,
          containerName: name,
          targetGroupArn: targetGroup.arn,
        },
      ],
    });

  }
  }


class PostgresDB extends Construct {
  public instance: Rds;

  constructor(
    scope: Construct,
    name: string,
    vpc: Vpc,
    serviceSecurityGroup: SecurityGroup
  ) {
    super(scope, name);


    const dbPort = 5432;

    const dbSecurityGroup = new SecurityGroup(this, `db-security-group`, {
      vpcId: Fn.tostring(vpc.vpcIdOutput),
      ingress: [
        // allow traffic to the DBs port from the service
        {
          fromPort: dbPort,
          toPort: dbPort,
          protocol: "TCP",
          securityGroups: [serviceSecurityGroup.id],
        },
      ],
      tags,
    });

    const password = new Password(this, "password", {length: 16}); 

    // Using this module: https://registry.terraform.io/modules/terraform-aws-modules/rds/aws/latest
    const db = new Rds(this, `db`, {
      identifier: `${name}-db`,

      "parameters": [
        {
          "name": "rds.force_ssl", 
          "value": "0"
        }
      ],   

      engine: "postgres",
      engineVersion: "16.1",
      family: "postgres16",
      majorEngineVersion: "16",
      instanceClass: "db.t3.micro",
      allocatedStorage: 5,


      createDbOptionGroup: false,
      createDbParameterGroup: true,
      applyImmediately: true,

      port: String(dbPort),
      username: `postgres`,
      dbName: "postgres",
      manageMasterUserPassword: false, 
      password: password.result, 
      skipFinalSnapshot: true, 
      

      maintenanceWindow: "Mon:00:00-Mon:03:00",
      backupWindow: "03:00-06:00",
      

      // This is necessary due to a shortcoming in our token system to be adressed in
      // https://github.com/hashicorp/terraform-cdk/issues/651
      subnetIds: vpc.databaseSubnetsOutput as unknown as any,
      vpcSecurityGroupIds: [dbSecurityGroup.id],
      dbSubnetGroupName: vpc.databaseSubnetGroupNameOutput, 

      tags,
    });  

    this.instance = db;
  }
}

class PushedECRImage extends Construct {
  tag: string;
  image: Resource;
  constructor(scope: Construct, name: string, projectPath: string) {
    super(scope, name);

    const assetBackend = new TerraformAsset(this, `dockerArtifactSource`, {
      path: projectPath
    });

    const artifactHash = assetBackend.assetHash;

    const repo = new EcrRepository(this, `ecr`, {
      name,
      tags,
      forceDelete: true, 
    });

    const auth = new DataAwsEcrAuthorizationToken(this, `auth`, {
      dependsOn: [repo],
      registryId: repo.registryId,
    });

    this.tag = `${repo.repositoryUrl}:${artifactHash}`;
    // Workaround due to https://github.com/kreuzwerker/terraform-provider-docker/issues/189
    this.image = new Resource(this, `image`, {

      triggers: {
        key: artifactHash
      },
      provisioners: [
        {
          type: "local-exec",
          workingDir: projectPath,
          command: `docker login -u ${auth.userName} -p ${auth.password} ${auth.proxyEndpoint} && 
  docker build -t ${this.tag} . && 
  docker push ${this.tag}`,
        },
      ],
    });
   
  }
}


class MyStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);

    new AwsProvider(this, "aws", {
      region: REGION,
    });

    new NullProvider(this, "null", {}); 
    new RandomProvider(this, "random", {});

    const vpc = new Vpc(this, `vpc`, {
      // We use the name of the stack
      name,
      // We tag every resource with the same set of tags to easily identify the resources
      cidr: "10.0.0.0/16",
      // We want to run on three availability zones
      azs: ["a", "b", "c"].map((i) => `${REGION}${i}`),
      // We need three CIDR blocks as we have three availability zones
      privateSubnets: ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"],
      publicSubnets: ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"],
      databaseSubnets: ["10.0.201.0/24", "10.0.202.0/24", "10.0.203.0/24"],
      enableNatGateway: true,
      // Using a single NAT Gateway will save us some money, coming with the cost of less redundancy
      singleNatGateway: true,
    });  

    const cluster = new Cluster(this, `${name}-cluster`);

    const loadBalancer = new LoadBalancer(
      this,
      `${name}-load-balancer`,
      vpc,
      cluster.cluster
    );

    const serviceSecurityGroup = new SecurityGroup(
      this,
      `${name}-service-security-group`,
      {
        vpcId: vpc.vpcIdOutput,
        tags,
        ingress: [
          // only allow incoming traffic from our load balancer
          {
            protocol: "TCP",
            fromPort: 80,
            toPort: 80,
            securityGroups: loadBalancer.lb.securityGroups,
          },

        ],
        egress: [
          // allow all outgoing traffic
          {
            fromPort: 0,
            toPort: 0,
            protocol: "-1",
            cidrBlocks: ["0.0.0.0/0"],
            ipv6CidrBlocks: ["::/0"],
          },
        ],
      }
    );

    const db = new PostgresDB(
      this,
      `${name}-pg`,
      vpc,
      serviceSecurityGroup
    );

    const { image: backendImage, tag: backendTag } = new PushedECRImage(
      this,
      name,
      path.resolve(__dirname, "../backend"), 
    );

    const task = cluster.runDockerImage(name, backendImage, backendTag,{
      PORT: "3000",
      PG_USER: db.instance.username,
      PG_PASSWORD: db.instance.password,
      PG_DATABASE: db.instance.dbInstanceNameOutput,
      PG_HOST: Fn.tostring(db.instance.dbInstanceAddressOutput),
      PG_PORT: Fn.tostring(db.instance.dbInstancePortOutput),
    });

    loadBalancer.exposeService(
      name,
      task,
      serviceSecurityGroup,
      '/'
    );

    const cdn = new CloudfrontDistribution(this, "cf", {
      comment: `Docker example frontend`,
      tags,
      enabled: true,
      defaultCacheBehavior: {
        targetOriginId: BACKEND_ORIGIN_ID,
          // Allow every method as we want to also serve the backend through this
          allowedMethods: [
            "DELETE",
            "GET",
            "HEAD",
            "OPTIONS",
            "PATCH",
            "POST",
            "PUT",
          ],
          cachedMethods: ["GET", "HEAD"],
          viewerProtocolPolicy: "redirect-to-https", // ensure we serve https
          forwardedValues: { queryString: false, cookies: { forward: "none" } },
          
        },
      
      // origins describe different entities that can serve traffic
      origin: [
        {
          domainName: loadBalancer.lb.dnsName, // our backend is served by the load balancer
          originId: BACKEND_ORIGIN_ID,
          customOriginConfig:             {
              originProtocolPolicy: "http-only",
              httpPort: 80,
              httpsPort: 443,
              originSslProtocols: ["TLSv1.2", "TLSv1.1", "TLSv1"],
            },
          
        },
      ],

      restrictions: { geoRestriction: { restrictionType: "none" } },
      viewerCertificate: { cloudfrontDefaultCertificate: true }, // we use the default SSL Certificate
    });


    new TerraformOutput(this, "domainName", {
      value: cdn.domainName,
    });
    
  }
}

//https://github.com/hashicorp/terraform-provider-aws/issues/30902
const app = new App();
const stack = new MyStack(app, PROJECT_NAME);
app.synth();


