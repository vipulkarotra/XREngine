import AWS from 'aws-sdk'
import { DataConsumer, DataProducer } from 'mediasoup/node/lib/types'

import { User } from '@xrengine/common/src/interfaces/User'
import { UserId } from '@xrengine/common/src/interfaces/UserId'
import { SpawnPoints } from '@xrengine/engine/src/avatar/AvatarSpawnSystem'
import checkValidPositionOnGround from '@xrengine/engine/src/common/functions/checkValidPositionOnGround'
import { Engine } from '@xrengine/engine/src/ecs/classes/Engine'
import { Action } from '@xrengine/engine/src/ecs/functions/Action'
import { getComponent } from '@xrengine/engine/src/ecs/functions/ComponentFunctions'
import { useWorld } from '@xrengine/engine/src/ecs/functions/SystemHooks'
import { Network } from '@xrengine/engine/src/networking/classes/Network'
import { dispatchFrom } from '@xrengine/engine/src/networking/functions/dispatchFrom'
import { NetworkWorldAction } from '@xrengine/engine/src/networking/functions/NetworkWorldAction'
import { JoinWorldProps } from '@xrengine/engine/src/networking/functions/receiveJoinWorld'
import { Object3DComponent } from '@xrengine/engine/src/scene/components/Object3DComponent'
import { TransformComponent } from '@xrengine/engine/src/transform/components/TransformComponent'
import config from '@xrengine/server-core/src/appconfig'
import { localConfig } from '@xrengine/server-core/src/config'
import logger from '@xrengine/server-core/src/logger'
import getLocalServerIp from '@xrengine/server-core/src/util/get-local-server-ip'

import { SocketWebRTCServerTransport } from './SocketWebRTCServerTransport'
import { closeTransport } from './WebRTCFunctions'

const gsNameRegex = /gameserver-([a-zA-Z0-9]{5}-[a-zA-Z0-9]{5})/

export const setupSubdomain = async (transport: SocketWebRTCServerTransport) => {
  const app = transport.app
  let stringSubdomainNumber: string

  if (config.kubernetes.enabled) {
    await cleanupOldGameservers(transport)
    app.gameServer = await app.agonesSDK.getGameServer()

    // We used to provision subdomains for gameservers, e.g. 00001.gameserver.domain.com
    // This turned out to be unnecessary, and in fact broke Firefox's ability to connect via
    // UDP, so the following was commented out.
    // const name = app.gameServer.objectMeta.name
    // const gsIdentifier = gsNameRegex.exec(name)!
    // stringSubdomainNumber = await getFreeSubdomain(transport, gsIdentifier[1], 0)
    // app.gsSubdomainNumber = stringSubdomainNumber
    //
    // const Route53 = new AWS.Route53({ ...config.aws.route53.keys })
    // const params = {
    //   ChangeBatch: {
    //     Changes: [
    //       {
    //         Action: 'UPSERT',
    //         ResourceRecordSet: {
    //           Name: `${stringSubdomainNumber}.${config.gameserver.domain}`,
    //           ResourceRecords: [{ Value: app.gameServer.status.address }],
    //           TTL: 0,
    //           Type: 'A'
    //         }
    //       }
    //     ]
    //   },
    //   HostedZoneId: config.aws.route53.hostedZoneId
    // }
    // if (config.gameserver.local !== true) await Route53.changeResourceRecordSets(params as any).promise()
  } else {
    try {
      // is this needed?
      await (app.service('instance') as any).Model.update(
        { ended: true, assigned: false, assignedAt: null },
        { where: {} }
      )
    } catch (error) {
      logger.warn(error)
    }
  }

  // Set up our gameserver according to our current environment
  const localIp = await getLocalServerIp(app.isChannelInstance)
  const announcedIp = config.kubernetes.enabled ? app.gameServer.status.address : localIp.ipAddress

  localConfig.mediasoup.webRtcTransport.listenIps = [
    {
      ip: '0.0.0.0',
      announcedIp
    }
  ]
}

export async function getFreeSubdomain(
  transport: SocketWebRTCServerTransport,
  gsIdentifier: string,
  subdomainNumber: number
): Promise<string> {
  const stringSubdomainNumber = subdomainNumber.toString().padStart(config.gameserver.identifierDigits, '0')
  const subdomainResult = await transport.app.service('gameserver-subdomain-provision').find({
    query: {
      gs_number: stringSubdomainNumber
    }
  })
  if ((subdomainResult as any).total === 0) {
    await transport.app.service('gameserver-subdomain-provision').create({
      allocated: true,
      gs_number: stringSubdomainNumber,
      gs_id: gsIdentifier
    })

    await new Promise((resolve) =>
      setTimeout(async () => {
        resolve(true)
      }, 500)
    )

    const newSubdomainResult = (await transport.app.service('gameserver-subdomain-provision').find({
      query: {
        gs_number: stringSubdomainNumber
      }
    })) as any
    if (newSubdomainResult.total > 0 && newSubdomainResult.data[0].gs_id === gsIdentifier) return stringSubdomainNumber
    else return getFreeSubdomain(transport, gsIdentifier, subdomainNumber + 1)
  } else {
    const subdomain = (subdomainResult as any).data[0]
    if (subdomain.allocated === true || subdomain.allocated === 1) {
      return getFreeSubdomain(transport, gsIdentifier, subdomainNumber + 1)
    }
    await transport.app.service('gameserver-subdomain-provision').patch(subdomain.id, {
      allocated: true,
      gs_id: gsIdentifier
    })

    await new Promise((resolve) =>
      setTimeout(async () => {
        resolve(true)
      }, 500)
    )

    const newSubdomainResult = (await transport.app.service('gameserver-subdomain-provision').find({
      query: {
        gs_number: stringSubdomainNumber
      }
    })) as any
    if (newSubdomainResult.total > 0 && newSubdomainResult.data[0].gs_id === gsIdentifier) return stringSubdomainNumber
    else return getFreeSubdomain(transport, gsIdentifier, subdomainNumber + 1)
  }
}

export async function cleanupOldGameservers(transport: SocketWebRTCServerTransport): Promise<void> {
  const instances = await (transport.app.service('instance') as any).Model.findAndCountAll({
    offset: 0,
    limit: 1000,
    where: {
      ended: false
    }
  })
  const gameservers = await transport.app.k8AgonesClient.listNamespacedCustomObject(
    'agones.dev',
    'v1',
    'default',
    'gameservers'
  )

  await Promise.all(
    instances.rows.map((instance) => {
      if (!instance.ipAddress) return false
      const [ip, port] = instance.ipAddress.split(':')
      const match = (gameservers?.body! as any).items.find((gs) => {
        if (gs.status.ports == null || gs.status.address === '') return false
        const inputPort = gs.status.ports.find((port) => port.name === 'default')
        return gs.status.address === ip && inputPort.port.toString() === port
      })
      return match == null
        ? transport.app.service('instance').patch(instance.id, {
            ended: true
          })
        : Promise.resolve()
    })
  )

  const gsIds = (gameservers?.body! as any).items.map((gs) =>
    gsNameRegex.exec(gs.metadata.name) != null ? gsNameRegex.exec(gs.metadata.name)![1] : null
  )

  await transport.app.service('gameserver-subdomain-provision').patch(
    null,
    {
      allocated: false
    },
    {
      query: {
        gs_id: {
          $nin: gsIds
        }
      }
    }
  )

  return
}

export function getUserIdFromSocketId(socketId) {
  const client = Array.from(Engine.currentWorld.clients.values()).find((c) => c.socketId === socketId)
  return client?.userId
}

export function handleConnectToWorld(
  transport: SocketWebRTCServerTransport,
  socket,
  data,
  callback,
  userId: UserId,
  user,
  avatarDetail
) {
  console.log('Connect to world from ' + userId)
  // console.log("Avatar detail is", avatarDetail);

  if (disconnectClientIfConnected(socket, userId)) return callback(null! as any)

  // Create a new client object
  // and add to the dictionary
  const world = useWorld()
  const userIndex = world.userIndexCount++
  world.clients.set(userId, {
    userId: userId,
    userIndex,
    name: user.dataValues.name,
    avatarDetail,
    socket: socket,
    socketId: socket.id,
    lastSeenTs: Date.now(),
    joinTs: Date.now(),
    media: {},
    consumerLayers: {},
    stats: {},
    subscribedChatUpdates: [],
    dataConsumers: new Map<string, DataConsumer>(), // Key => id of data producer
    dataProducers: new Map<string, DataProducer>() // Key => label of data channel
  })

  world.userIdToUserIndex.set(userId, userIndex)
  world.userIndexToUserId.set(userIndex, userId)

  // Return initial world state to client to set things up
  callback({
    routerRtpCapabilities: transport.routers.instance[0].rtpCapabilities
  })
}

function disconnectClientIfConnected(socket, userId: UserId) {
  // If we are already logged in, kick the other socket
  const world = Engine.currentWorld
  if (world.clients.has(userId) && world.clients.get(userId)!.socketId !== socket.id) {
    // const client = world.clients.get(userId)!
    console.log('Client already logged in, disallowing new connection')

    // todo: kick old client instead of new one
    // console.log('Client already exists, kicking the old client and disconnecting')
    // client.socket?.emit(MessageTypes.Kick.toString(), 'You joined this world on another device')
    // client.socket?.disconnect()
    // for (const eid of world.getOwnedNetworkObjects(userId)) {
    //   const { networkId } = getComponent(eid, NetworkObjectComponent)
    //   dispatchFrom(world.hostId, () => NetworkWorldAction.destroyObject({ $from: userId, networkId }))
    // }
    return true
  }
}

export const handleJoinWorld = async (
  transport: SocketWebRTCServerTransport,
  socket,
  data,
  callback: (args: JoinWorldProps) => void,
  joinedUserId: UserId,
  user
) => {
  if (disconnectClientIfConnected(socket, joinedUserId)) return callback(null! as any)

  let spawnPose = SpawnPoints.instance.getRandomSpawnPoint()
  const inviteCode = data['inviteCode']

  if (inviteCode) {
    const result = (await transport.app.service('user').find({
      query: {
        action: 'invite-code-lookup',
        inviteCode: inviteCode
      }
    })) as any

    let users = result.data as User[]
    if (users.length > 0) {
      const inviterUser = users[0]
      if (inviterUser.instanceId === user.instanceId) {
        const inviterUserId = inviterUser.id
        const inviterUserAvatarEntity = Engine.currentWorld.getUserAvatarEntity(inviterUserId as UserId)
        const inviterUserTransform = getComponent(inviterUserAvatarEntity, TransformComponent)

        // Translate infront of the inviter
        const inviterUserObject3d = getComponent(inviterUserAvatarEntity, Object3DComponent)
        inviterUserObject3d.value.translateZ(2)

        const validSpawnablePosition = checkValidPositionOnGround(inviterUserObject3d.value.position)

        if (validSpawnablePosition) {
          spawnPose = {
            position: inviterUserObject3d.value.position,
            rotation: inviterUserTransform.rotation
          }
        }
      } else {
        console.warn('The user who invited this user in no longer on this instnace!')
      }
    }
  }

  console.info('JoinWorld received', joinedUserId, data, spawnPose)
  const world = Engine.currentWorld
  const client = world.clients.get(joinedUserId)!

  if (!client) return callback(null! as any)

  clearCachedActionsForDisconnectedUsers()
  clearCachedActionsForUser(joinedUserId)

  // send all client info
  const clients = [] as Array<{ userId: UserId; name: string; index: number }>
  for (const [userId, client] of world.clients) {
    clients.push({ userId, index: client.userIndex, name: client.name })
  }

  // send all cached and outgoing actions to joining user
  const cachedActions = [] as Action[]
  for (const action of world.cachedActions as Set<ReturnType<typeof NetworkWorldAction.spawnAvatar>>) {
    // we may have a need to remove the check for the prefab type to enable this to work for networked objects too
    if (action.type === 'network.SPAWN_OBJECT' && action.prefab === 'avatar') {
      const ownerId = action.$from
      if (ownerId) {
        const entity = world.getNetworkObject(ownerId, action.networkId)
        if (typeof entity !== 'undefined') {
          const transform = getComponent(entity, TransformComponent)
          action.parameters.position = transform.position
          action.parameters.rotation = transform.rotation
        }
      }
    }
    if (action.$to === 'all' || action.$to === joinedUserId) cachedActions.push(action)
  }

  console.log('Sending cached actions ', cachedActions)

  callback({
    tick: world.fixedTick,
    clients,
    cachedActions,
    avatarDetail: client.avatarDetail!,
    avatarSpawnPose: spawnPose
  })

  dispatchFrom(world.hostId, () =>
    NetworkWorldAction.createClient({
      $from: joinedUserId,
      name: client.name,
      index: client.userIndex
    })
  ).to('others')
}

export function handleIncomingActions(socket, message) {
  if (!message) return

  const world = Engine.currentWorld
  const userIdMap = {} as { [socketId: string]: UserId }
  for (const [id, client] of world.clients) userIdMap[client.socketId!] = id

  const actions = /*decode(new Uint8Array(*/ message /*))*/ as Required<Action>[]
  for (const a of actions) {
    a['$fromSocketId'] = socket.id
    a.$from = userIdMap[socket.id]
    world.outgoingActions.add(a)
  }
  // console.log('SERVER INCOMING ACTIONS', JSON.stringify(actions))
}

export async function handleHeartbeat(socket): Promise<any> {
  const userId = getUserIdFromSocketId(socket.id)!
  // console.log('Got heartbeat from user ' + userId + ' at ' + Date.now());
  if (Engine.currentWorld.clients.has(userId)) Engine.currentWorld.clients.get(userId)!.lastSeenTs = Date.now()
}

export async function handleDisconnect(socket): Promise<any> {
  const world = Engine.currentWorld
  const userId = getUserIdFromSocketId(socket.id) as UserId
  const disconnectedClient = world?.clients.get(userId)
  if (!disconnectedClient)
    return console.warn(
      'Disconnecting client ' + userId + ' was undefined, probably already handled from JoinWorld handshake'
    )
  //On local, new connections can come in before the old sockets are disconnected.
  //The new connection will overwrite the socketID for the user's client.
  //This will only clear transports if the client's socketId matches the socket that's disconnecting.
  if (socket.id === disconnectedClient?.socketId) {
    dispatchFrom(world.hostId, () => NetworkWorldAction.destroyClient({ $from: userId }))
    logger.info('Disconnecting clients for user ' + userId)
    if (disconnectedClient?.instanceRecvTransport) disconnectedClient.instanceRecvTransport.close()
    if (disconnectedClient?.instanceSendTransport) disconnectedClient.instanceSendTransport.close()
    if (disconnectedClient?.channelRecvTransport) disconnectedClient.channelRecvTransport.close()
    if (disconnectedClient?.channelSendTransport) disconnectedClient.channelSendTransport.close()
  } else {
    console.warn("Socket didn't match for disconnecting client")
  }
}

export async function handleLeaveWorld(socket, data, callback): Promise<any> {
  const world = useWorld()
  const userId = getUserIdFromSocketId(socket.id)!
  if (Network.instance.transports)
    for (const [, transport] of Object.entries(Network.instance.transports))
      if ((transport as any).appData.peerId === userId) closeTransport(transport)
  if (world.clients.has(userId)) {
    dispatchFrom(world.hostId, () => NetworkWorldAction.destroyClient({ $from: userId }))
  }
  if (callback !== undefined) callback({})
}

export function clearCachedActionsForDisconnectedUsers() {
  for (const action of Engine.currentWorld.cachedActions) {
    if (Engine.currentWorld.clients.has(action.$from) === false) {
      Engine.currentWorld.cachedActions.delete(action)
    }
  }
}

export function clearCachedActionsForUser(user: UserId) {
  for (const action of Engine.currentWorld.cachedActions) {
    if (action.$from === user) {
      Engine.currentWorld.cachedActions.delete(action)
    }
  }
}
