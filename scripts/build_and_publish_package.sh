#!/bin/bash
set -e
set -x

STAGE=$1
LABEL=$2
PACKAGE=$3
START_TIME=$4
PRIVATE_ECR=$5
REGION=$6

DOCKER_BUILDKIT=1 docker build -t $LABEL-$PACKAGE -f dockerfiles/$PACKAGE/Dockerfile-$PACKAGE \
  --build-arg MYSQL_HOST=$MYSQL_HOST \
  --build-arg MYSQL_PORT=$MYSQL_PORT \
  --build-arg MYSQL_PASSWORD=$MYSQL_PASSWORD \
  --build-arg MYSQL_USER=$MYSQL_USER \
  --build-arg MYSQL_DATABASE=$MYSQL_DATABASE .
bash ./scripts/publish_ecr.sh $RELEASE_NAME ${TAG}__${START_TIME} $DOCKER_LABEL $PACKAGE $PRIVATE_ECR $AWS_REGION
