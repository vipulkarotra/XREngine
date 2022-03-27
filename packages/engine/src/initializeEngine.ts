import { detect, detectOS } from 'detect-browser'
import _ from 'lodash'
import {
  BufferGeometry,
  Euler,
  Mesh,
  PerspectiveCamera,
  AudioListener as PositionalAudioListener,
  Quaternion,
  Scene
} from 'three'
//@ts-ignore
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'

// import { loadEngineInjection } from '@xrengine/projects/loadEngineInjection'
import { getGLTFLoader } from './assets/classes/AssetLoader'
import { initializeKTX2Loader } from './assets/functions/createGLTFLoader'
import { loadDRACODecoder } from './assets/loaders/gltf/NodeDracoLoader'
import { AudioListener } from './audio/StereoAudioListener'
import { BotHookFunctions } from './bot/functions/botHookFunctions'
import { isClient } from './common/functions/isClient'
import { Timer } from './common/functions/Timer'
import { Engine } from './ecs/classes/Engine'
import { EngineEvents } from './ecs/classes/EngineEvents'
import { EngineActions, EngineEventReceptor } from './ecs/classes/EngineService'
import { createWorld, World } from './ecs/classes/World'
import { reset } from './ecs/functions/EngineFunctions'
import { initSystems, SystemModuleType } from './ecs/functions/SystemFunctions'
import { useWorld } from './ecs/functions/SystemHooks'
import { SystemUpdateType } from './ecs/functions/SystemUpdateType'
import { removeClientInputListeners } from './input/functions/clientInputListeners'
import { Network } from './networking/classes/Network'
import { dispatchLocal } from './networking/functions/dispatchFrom'
import { receiveActionOnce } from './networking/functions/matchActionOnce'
import { NetworkActionReceptors } from './networking/functions/NetworkActionReceptors'
import { ObjectLayers } from './scene/constants/ObjectLayers'
import { registerPrefabs } from './scene/functions/registerPrefabs'
import { registerDefaultSceneFunctions } from './scene/functions/registerSceneFunctions'
import { FontManager } from './xrui/classes/FontManager'

// threejs overrides

// @ts-ignore
Quaternion.prototype.toJSON = function () {
  return { x: this._x, y: this._y, z: this._z, w: this._w }
}

// @ts-ignore
Euler.prototype.toJSON = function () {
  return { x: this._x, y: this._y, z: this._z, order: this._order }
}

Mesh.prototype.raycast = acceleratedRaycast
BufferGeometry.prototype['disposeBoundsTree'] = disposeBoundsTree
BufferGeometry.prototype['computeBoundsTree'] = computeBoundsTree

/**
 * initializeBrowser
 *
 * initializes everything for the browser context
 */
export const initializeBrowser = () => {
  Engine.publicPath = location.origin
  Engine.audioListener = new PositionalAudioListener()
  Engine.camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 10000)
  Engine.camera.layers.disableAll()
  Engine.camera.layers.enable(ObjectLayers.Scene)
  Engine.camera.layers.enable(ObjectLayers.Avatar)
  Engine.camera.layers.enable(ObjectLayers.UI)
  Engine.camera.add(Engine.audioListener)

  const browser = detect()
  const os = detectOS(navigator.userAgent)

  // Add iOS and safari flag to window object -- To use it for creating an iOS compatible WebGLRenderer for example
  ;(window as any).iOS =
    os === 'iOS' ||
    /iPad|iPhone|iPod/.test(navigator.platform) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  ;(window as any).safariWebBrowser = browser?.name === 'safari'

  Engine.isHMD = /Oculus/i.test(navigator.userAgent) // TODO: more HMDs;

  globalThis.botHooks = BotHookFunctions

  const joinedWorld = () => {
    Engine.hasJoinedWorld = true
  }
  receiveActionOnce(EngineEvents.EVENTS.JOINED_WORLD, joinedWorld)

  setupInitialClickListener()

  // maybe needs to be awaited?
  FontManager.instance.getDefaultFont()

  receiveActionOnce(EngineEvents.EVENTS.CONNECT, (action: any) => {
    Engine.userId = action.id
  })
}

const setupInitialClickListener = () => {
  const initialClickListener = () => {
    dispatchLocal(EngineActions.setUserHasInteracted())
    window.removeEventListener('click', initialClickListener)
    window.removeEventListener('touchend', initialClickListener)
  }
  window.addEventListener('click', initialClickListener)
  window.addEventListener('touchend', initialClickListener)
}

/**
 * initializeNode
 *
 * initializes everything for the ndoe context
 */
export const initializeNode = () => {
  const joinedWorld = () => {
    dispatchLocal(EngineActions.enableScene({ physics: true }))
    Engine.hasJoinedWorld = true
  }
  receiveActionOnce(EngineEvents.EVENTS.JOINED_WORLD, joinedWorld)
}

export const createEngine = () => {
  const world = createWorld()
  Engine.currentWorld = world
  Engine.scene = new Scene()
  Engine.scene.layers.set(ObjectLayers.Scene)

  registerDefaultSceneFunctions(world)
  registerPrefabs(world)

  world.receptors.push(EngineEventReceptor)

  globalThis.Engine = Engine
  globalThis.EngineEvents = EngineEvents
  globalThis.Network = Network
}

export const initializeMediaServerSystems = async () => {
  const coreSystems: SystemModuleType<any>[] = []
  coreSystems.push(
    {
      type: SystemUpdateType.UPDATE,
      systemModulePromise: import('./ecs/functions/FixedPipelineSystem'),
      args: { tickRate: 60 }
    },
    {
      type: SystemUpdateType.FIXED_EARLY,
      systemModulePromise: import('./ecs/functions/ActionDispatchSystem')
    },
    {
      type: SystemUpdateType.FIXED_LATE,
      systemModulePromise: import('./ecs/functions/ActionCleanupSystem')
    }
  )

  const world = useWorld()

  await initSystems(world, coreSystems)

  const executeWorlds = (delta, elapsedTime) => {
    for (const world of Engine.worlds) {
      world.execute(delta, elapsedTime)
    }
  }

  NetworkActionReceptors.createNetworkActionReceptor(world)

  Engine.engineTimer = Timer(executeWorlds)
  Engine.engineTimer.start()

  Engine.isInitialized = true
  dispatchLocal(EngineActions.initializeEngine(true) as any)
}

export const initializeCoreSystems = async (systems: SystemModuleType<any>[] = []) => {
  const systemsToLoad: SystemModuleType<any>[] = []
  systemsToLoad.push(
    {
      type: SystemUpdateType.UPDATE,
      systemModulePromise: import('./ecs/functions/FixedPipelineSystem'),
      args: { tickRate: 60 }
    },
    {
      type: SystemUpdateType.FIXED_EARLY,
      systemModulePromise: import('./ecs/functions/ActionDispatchSystem')
    },
    {
      type: SystemUpdateType.FIXED_LATE,
      systemModulePromise: import('./scene/systems/NamedEntitiesSystem')
    },
    {
      type: SystemUpdateType.FIXED_LATE,
      systemModulePromise: import('./transform/systems/TransformSystem')
    },
    {
      type: SystemUpdateType.FIXED_LATE,
      systemModulePromise: import('./scene/systems/SceneObjectSystem')
    },
    {
      type: SystemUpdateType.FIXED_LATE,
      systemModulePromise: import('./ecs/functions/ActionCleanupSystem')
    }
  )

  if (isClient) {
    systemsToLoad.push(
      {
        type: SystemUpdateType.POST_RENDER,
        systemModulePromise: import('./renderer/WebGLRendererSystem')
      },
      {
        type: SystemUpdateType.UPDATE,
        systemModulePromise: import('./xr/systems/XRSystem')
      },
      {
        type: SystemUpdateType.UPDATE,
        systemModulePromise: import('./input/systems/ClientInputSystem')
      },
      {
        type: SystemUpdateType.UPDATE,
        systemModulePromise: import('./xrui/systems/XRUISystem')
      }
    )
  }

  const world = useWorld()
  await initSystems(world, systemsToLoad)

  // load injected systems which may rely on core systems
  await initSystems(world, systems)

  const executeWorlds = (delta, elapsedTime) => {
    for (const world of Engine.worlds) {
      world.execute(delta, elapsedTime)
    }
  }

  Engine.engineTimer = Timer(executeWorlds)
  Engine.engineTimer.start()

  Engine.isInitialized = true
  dispatchLocal(EngineActions.initializeEngine(true) as any)
}

/**
 * everything needed for rendering 3d scenes
 */

export const initializeSceneSystems = async () => {
  const world = useWorld()
  NetworkActionReceptors.createNetworkActionReceptor(world)

  const systemsToLoad: SystemModuleType<any>[] = []

  systemsToLoad.push(
    {
      type: SystemUpdateType.FIXED,
      systemModulePromise: import('./avatar/AvatarSpawnSystem')
    },
    {
      type: SystemUpdateType.FIXED,
      systemModulePromise: import('./avatar/AvatarSystem')
    },
    {
      type: SystemUpdateType.FIXED_LATE,
      systemModulePromise: import('./interaction/systems/EquippableSystem')
    },
    {
      type: SystemUpdateType.FIXED_LATE,
      systemModulePromise: import('./scene/systems/TriggerSystem')
    },
    {
      type: SystemUpdateType.FIXED_LATE,
      systemModulePromise: import('./physics/systems/PhysicsSystem')
    }
  )
  if (isClient) {
    systemsToLoad.push(
      {
        type: SystemUpdateType.UPDATE,
        systemModulePromise: import('./navigation/systems/AutopilotSystem')
      },
      {
        type: SystemUpdateType.UPDATE,
        systemModulePromise: import('./scene/systems/HyperspacePortalSystem')
      },
      {
        type: SystemUpdateType.UPDATE,
        systemModulePromise: import('./ikrig/systems/SkeletonRigSystem')
      },
      {
        type: SystemUpdateType.UPDATE,
        systemModulePromise: import('./camera/systems/CameraSystem')
      },
      {
        type: SystemUpdateType.FIXED,
        systemModulePromise: import('./bot/systems/BotHookSystem')
      },
      {
        type: SystemUpdateType.FIXED,
        systemModulePromise: import('./avatar/AvatarControllerSystem')
      },
      {
        type: SystemUpdateType.PRE_RENDER,
        systemModulePromise: import('./interaction/systems/InteractiveSystem')
      },
      {
        type: SystemUpdateType.PRE_RENDER,
        systemModulePromise: import('./interaction/systems/MediaControlSystem')
      },
      {
        type: SystemUpdateType.PRE_RENDER,
        systemModulePromise: import('./audio/systems/AudioSystem')
      },
      {
        type: SystemUpdateType.PRE_RENDER,
        systemModulePromise: import('./audio/systems/PositionalAudioSystem')
      },
      {
        type: SystemUpdateType.PRE_RENDER,
        systemModulePromise: import('./avatar/AvatarLoadingSystem')
      },
      {
        type: SystemUpdateType.PRE_RENDER,
        systemModulePromise: import('./avatar/AnimationSystem')
      },
      {
        type: SystemUpdateType.PRE_RENDER,
        systemModulePromise: import('./scene/systems/RendererUpdateSystem')
      },
      {
        type: SystemUpdateType.PRE_RENDER,
        systemModulePromise: import('./particles/systems/ParticleSystem')
      },
      {
        type: SystemUpdateType.PRE_RENDER,
        systemModulePromise: import('./debug/systems/DebugHelpersSystem')
      },
      {
        type: SystemUpdateType.PRE_RENDER,
        systemModulePromise: import('./renderer/HighlightSystem')
      },
      {
        systemModulePromise: import('./scene/systems/EntityNodeEventSystem'),
        type: SystemUpdateType.PRE_RENDER
      }
    )
  }

  if (isClient) initializeKTX2Loader(getGLTFLoader())

  await initSystems(world, systemsToLoad)
}

export const initializeRealtimeSystems = async (media = true, pose = true) => {
  const systemsToLoad: SystemModuleType<any>[] = []

  if (media) {
    systemsToLoad.push({
      type: SystemUpdateType.PRE_RENDER,
      systemModulePromise: import('./networking/systems/MediaStreamSystem')
    })
  }

  if (pose) {
    systemsToLoad.push(
      {
        type: SystemUpdateType.FIXED_EARLY,
        systemModulePromise: import('./networking/systems/IncomingNetworkSystem')
      },
      {
        type: SystemUpdateType.FIXED_LATE,
        systemModulePromise: import('./networking/systems/OutgoingNetworkSystem')
      }
    )
  }

  const world = useWorld()
  await initSystems(world, systemsToLoad)
}

// export const initializeProjectSystems = async (projects: string[] = [], systems: SystemModuleType<any>[] = []) => {
//   const world = useWorld()
//   await initSystems(world, systems)
//   await loadEngineInjection(world, projects)
// }

export const shutdownEngine = async () => {
  removeClientInputListeners()

  Engine.engineTimer?.clear()
  Engine.engineTimer = null!

  reset()
}
