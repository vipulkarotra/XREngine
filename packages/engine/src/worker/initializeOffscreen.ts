import _ from 'lodash';
import { BufferGeometry, Mesh, PerspectiveCamera, Scene } from 'three';
import { acceleratedRaycast, computeBoundsTree } from "three-mesh-bvh";
import { CameraSystem } from '../camera/systems/CameraSystem';
import { Timer } from '../common/functions/Timer';
import { DebugHelpersSystem } from '../debug/systems/DebugHelpersSystem';
import { Engine, AudioListener } from '../ecs/classes/Engine';
import { execute, initialize } from "../ecs/functions/EngineFunctions";
import { registerSystem } from '../ecs/functions/SystemFunctions';
import { SystemUpdateType } from "../ecs/functions/SystemUpdateType";
import { InteractiveSystem } from "../interaction/systems/InteractiveSystem";
import { Network } from '../networking/classes/Network';
import { ClientNetworkSystem } from '../networking/systems/ClientNetworkSystem';
import { ParticleSystem } from '../particles/systems/ParticleSystem';
import { PhysicsSystem } from '../physics/systems/PhysicsSystem';
import { HighlightSystem } from '../renderer/HighlightSystem';
import { WebGLRendererSystem } from '../renderer/WebGLRendererSystem';
import { ServerSpawnSystem } from '../scene/systems/ServerSpawnSystem';
import { StateSystem } from '../state/systems/StateSystem';
import { CharacterInputSchema } from '../character/CharacterInputSchema';
import { DefaultNetworkSchema } from '../networking/templates/DefaultNetworkSchema';
import { TransformSystem } from '../transform/systems/TransformSystem';
import { MainProxy } from './MessageQueue';
import { ActionSystem } from '../input/systems/ActionSystem';
import { EngineEvents } from '../ecs/classes/EngineEvents';
import { proxyEngineEvents } from '../ecs/classes/EngineEvents';
import { XRSystem } from '../xr/systems/XRSystem';
// import { PositionalAudioSystem } from './audio/systems/PositionalAudioSystem';
import { receiveWorker } from './MessageQueue';
import { AnimationManager } from "../character/AnimationManager";
import { CharacterControllerSystem } from '../character/CharacterControllerSystem';
import { UIPanelSystem } from '../ui/systems/UIPanelSystem';
//@ts-ignore
import PhysXWorker from '../physics/functions/loadPhysX.ts?worker';
import { PhysXInstance } from "three-physx";
import { ClientNetworkStateSystem } from '../networking/systems/ClientNetworkStateSystem';
import { loadScene } from '../scene/functions/SceneLoading';

Mesh.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype["computeBoundsTree"] = computeBoundsTree;

export const DefaultOffscreenInitializationOptions = {
  input: {
    schema: CharacterInputSchema,
  },
  networking: {
    schema: DefaultNetworkSchema
  },
};


/**
 * @todo
 * add proxies for all singletons (engine, systems etc) in the same way engine events has
 */


/**
 * 
 * @author Josh Field <github.com/HexaField>
 */
const initializeEngineOffscreen = async ({ canvas, userArgs }, proxy: MainProxy) => {
  const { initOptions, useOfflineMode, postProcessing } = userArgs;
  const options = _.defaultsDeep({}, initOptions, DefaultOffscreenInitializationOptions);

  proxyEngineEvents(proxy);
  EngineEvents.instance.once(EngineEvents.EVENTS.LOAD_SCENE, ({ sceneData }) => { loadScene(sceneData); })
  EngineEvents.instance.once(EngineEvents.EVENTS.JOINED_WORLD, () => {
    EngineEvents.instance.dispatchEvent({ type: EngineEvents.EVENTS.ENABLE_SCENE, enable: true });
  })

  initialize();
  Engine.scene = new Scene();
  Engine.publicPath = location.origin;


  Network.instance = new Network();
  Network.instance.schema = options.networking.schema;
  // @ts-ignore
  Network.instance.transport = { isServer: false }

  new AnimationManager();
  await Promise.all([
    PhysXInstance.instance.initPhysX(new PhysXWorker(), { }),
    AnimationManager.instance.getDefaultModel(),
  ]);

  registerSystem(PhysicsSystem);
  registerSystem(ActionSystem);
  registerSystem(StateSystem);
  registerSystem(ClientNetworkStateSystem);
  registerSystem(CharacterControllerSystem);
  registerSystem(ServerSpawnSystem, { priority: 899 });
  registerSystem(TransformSystem, { priority: 900 });
  registerSystem(UIPanelSystem);
  
  Engine.camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 10000);
  Engine.scene.add(Engine.camera);

  registerSystem(HighlightSystem);

  Engine.audioListener = new AudioListener();
  Engine.camera.add(Engine.audioListener);
  // registerSystem(PositionalAudioSystem);

  registerSystem(InteractiveSystem);
  registerSystem(ParticleSystem);
  registerSystem(DebugHelpersSystem);
  registerSystem(CameraSystem);
  registerSystem(WebGLRendererSystem, { priority: 1001, canvas, postProcessing });
  registerSystem(XRSystem, { offscreen: true });
  Engine.viewportElement = Engine.renderer.domElement;

  setInterval(() => {
    EngineEvents.instance.dispatchEvent({ type: EngineEvents.EVENTS.ENTITY_DEBUG_DATA, })
  }, 1000)

  await Promise.all(Engine.systems.map((system) => { 
    return new Promise<void>(async (resolve) => { await system.initialize(); system.initialized = true; resolve(); }) 
  }));
  
  Engine.engineTimer = Timer({
    networkUpdate: (delta:number, elapsedTime: number) => execute(delta, elapsedTime, SystemUpdateType.Network),
    fixedUpdate: (delta:number, elapsedTime: number) => execute(delta, elapsedTime, SystemUpdateType.Fixed),
    update: (delta, elapsedTime) => execute(delta, elapsedTime, SystemUpdateType.Free)
  }, Engine.physicsFrameRate, Engine.networkFramerate).start();

  EngineEvents.instance.once(ClientNetworkSystem.EVENTS.CONNECT, ({ id }) => {
    Network.instance.isInitialized = true;
    Network.instance.userId = id;
  })

  Engine.isInitialized = true;
}

receiveWorker(initializeEngineOffscreen)