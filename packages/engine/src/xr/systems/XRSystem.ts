import { ArrayCamera, sRGBEncoding } from 'three'

import { AssetLoader } from '../../assets/classes/AssetLoader'
import { BinaryValue } from '../../common/enums/BinaryValue'
import { LifecycleValue } from '../../common/enums/LifecycleValue'
import { Engine } from '../../ecs/classes/Engine'
import { EngineEvents } from '../../ecs/classes/EngineEvents'
import { accessEngineState, EngineActions, EngineActionType } from '../../ecs/classes/EngineService'
import { World } from '../../ecs/classes/World'
import { defineQuery, getComponent } from '../../ecs/functions/ComponentFunctions'
import { InputComponent } from '../../input/components/InputComponent'
import { LocalInputTagComponent } from '../../input/components/LocalInputTagComponent'
import { InputType } from '../../input/enums/InputType'
import { gamepadMapping } from '../../input/functions/GamepadInput'
import { dispatchLocal } from '../../networking/functions/dispatchFrom'
import { NetworkWorldAction } from '../../networking/functions/NetworkWorldAction'
import { ObjectLayers } from '../../scene/constants/ObjectLayers'
import { XRInputSourceComponent } from '../components/XRInputSourceComponent'
import { cleanXRInputs } from '../functions/addControllerModels'
import { updateXRControllerAnimations } from '../functions/controllerAnimation'
import { endXR, startWebXR } from '../functions/WebXRFunctions'

const startXRSession = async () => {
  const sessionInit = { optionalFeatures: ['local-floor', 'hand-tracking', 'layers'] }
  try {
    const session = await (navigator as any).xr.requestSession('immersive-vr', sessionInit)

    Engine.xrSession = session
    Engine.xrManager.setSession(session)
    Engine.xrManager.setFoveation(1)
    dispatchLocal(EngineActions.xrSession() as any)

    Engine.xrManager.addEventListener('sessionend', async () => {
      dispatchLocal(EngineActions.xrEnd() as any)
    })

    startWebXR()
  } catch (e) {
    console.error('Failed to create XR Session', e)
  }
}

/**
 * System for XR session and input handling
 * @author Josh Field <github.com/hexafield>
 */

export default async function XRSystem(world: World) {
  const localXRControllerQuery = defineQuery([InputComponent, LocalInputTagComponent, XRInputSourceComponent])
  const xrControllerQuery = defineQuery([XRInputSourceComponent])

  ;(navigator as any).xr?.isSessionSupported('immersive-vr').then((supported) => {
    dispatchLocal(EngineActions.xrSupported(supported) as any)
  })

  // TEMPORARY - precache controller model
  // Cache hand models
  await Promise.all([
    AssetLoader.loadAsync('/default_assets/controllers/hands/left.glb'),
    AssetLoader.loadAsync('/default_assets/controllers/hands/right.glb'),
    AssetLoader.loadAsync('/default_assets/controllers/hands/left_controller.glb'),
    AssetLoader.loadAsync('/default_assets/controllers/hands/right_controller.glb')
  ])

  Engine.currentWorld.receptors.push((action: EngineActionType) => {
    switch (action.type) {
      case NetworkWorldAction.setXRMode.type:
        // Current WebXRManager.getCamera() typedef is incorrect
        // @ts-ignore
        const cameras = Engine.xrManager.getCamera() as ArrayCamera
        cameras.layers.enableAll()
        cameras.cameras.forEach((camera) => {
          camera.layers.disableAll()
          camera.layers.enable(ObjectLayers.Scene)
          camera.layers.enable(ObjectLayers.Avatar)
          camera.layers.enable(ObjectLayers.UI)
        })
        break
      case EngineEvents.EVENTS.XR_START:
        if (accessEngineState().joinedWorld.value && !Engine.xrSession) startXRSession()
        break
      case EngineEvents.EVENTS.XR_END:
        for (const entity of xrControllerQuery()) {
          cleanXRInputs(entity)
        }
        endXR()
        break
    }
  })

  return () => {
    if (Engine.xrManager?.isPresenting) {
      const session = Engine.xrFrame.session
      for (const source of session.inputSources) {
        if (source.gamepad) {
          const mapping = gamepadMapping[source.gamepad.mapping || 'xr-standard'][source.handedness]
          source.gamepad?.buttons.forEach((button, index) => {
            // TODO : support button.touched and button.value
            const prev = Engine.prevInputState.get(mapping.buttons[index])
            if (!prev && button.pressed == false) return
            const continued = prev?.value && button.pressed
            Engine.inputState.set(mapping.buttons[index], {
              type: InputType.BUTTON,
              value: [button.pressed ? BinaryValue.ON : BinaryValue.OFF],
              lifecycleState: button.pressed
                ? continued
                  ? LifecycleValue.Continued
                  : LifecycleValue.Started
                : LifecycleValue.Ended
            })
          })
          const inputData =
            source.gamepad?.axes.length > 2
              ? [source.gamepad.axes[2], source.gamepad.axes[3]]
              : [source.gamepad.axes[0], source.gamepad.axes[1]]
          if (Math.abs(inputData[0]) < 0.05) {
            inputData[0] = 0
          }
          if (Math.abs(inputData[1]) < 0.05) {
            inputData[1] = 0
          }
          Engine.inputState.set(mapping.axes, {
            type: InputType.TWODIM,
            value: inputData,
            lifecycleState: LifecycleValue.Started
          })
        }
      }
    }

    //XR Controller mesh animation update
    for (const entity of xrControllerQuery()) {
      const inputSource = getComponent(entity, XRInputSourceComponent)
      updateXRControllerAnimations(inputSource)
    }

    for (const entity of localXRControllerQuery()) {
      const xrInputSourceComponent = getComponent(entity, XRInputSourceComponent)
      const head = xrInputSourceComponent.head
      head.quaternion.copy(Engine.camera.quaternion)
      head.position.copy(Engine.camera.position)
    }
  }
}
