import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  LocationInstanceConnectionService,
  useLocationInstanceConnectionState
} from '@xrengine/client-core/src/common/services/LocationInstanceConnectionService'
import { MediaInstanceConnectionService } from '@xrengine/client-core/src/common/services/MediaInstanceConnectionService'
import { useChatState } from '@xrengine/client-core/src/social/services/ChatService'
import { useLocationState } from '@xrengine/client-core/src/social/services/LocationService'
import { SocketWebRTCClientTransport } from '@xrengine/client-core/src/transports/SocketWebRTCClientTransport'
import { Engine } from '@xrengine/engine/src/ecs/classes/Engine'
import { EngineEvents } from '@xrengine/engine/src/ecs/classes/EngineEvents'
import { useEngineState } from '@xrengine/engine/src/ecs/classes/EngineService'
import { Network } from '@xrengine/engine/src/networking/classes/Network'

import WarningRefreshModal, { WarningRetryModalProps } from '../AlertModals/WarningRetryModal'

type GameServerWarningsProps = {
  locationName: string
}

const initialModalValues: WarningRetryModalProps = {
  open: false,
  title: '',
  body: ''
}

enum WarningModalTypes {
  INDEXED_DB_NOT_SUPPORTED,
  NO_GAME_SERVER_PROVISIONED,
  INSTANCE_DISCONNECTED,
  USER_KICKED,
  INVALID_LOCATION,
  INSTANCE_WEBGL_DISCONNECTED,
  CHANNEL_DISCONNECTED
}

const GameServerWarnings = (props: GameServerWarningsProps) => {
  const locationState = useLocationState()
  const [modalValues, setModalValues] = useState(initialModalValues)
  const [currentError, _setCurrentError] = useState(-1)
  const invalidLocationState = locationState.invalidLocation
  const engineState = useEngineState()
  const chatState = useChatState()
  const instanceConnectionState = useLocationInstanceConnectionState()
  const [erroredInstanceId, setErroredInstanceId] = useState(null)
  const { t } = useTranslation()

  const currentErrorRef = useRef(currentError)

  const setCurrentError = (value) => {
    currentErrorRef.current = value
    _setCurrentError(value)
  }

  useEffect(() => {
    EngineEvents.instance.addEventListener(
      SocketWebRTCClientTransport.EVENTS.PROVISION_INSTANCE_NO_GAMESERVERS_AVAILABLE,
      ({ instanceId }) => {
        setErroredInstanceId(instanceId)
        updateWarningModal(WarningModalTypes.NO_GAME_SERVER_PROVISIONED)
        setCurrentError(WarningModalTypes.NO_GAME_SERVER_PROVISIONED)
      }
    )

    EngineEvents.instance.addEventListener(SocketWebRTCClientTransport.EVENTS.INSTANCE_WEBGL_DISCONNECTED, () => {
      updateWarningModal(WarningModalTypes.INSTANCE_WEBGL_DISCONNECTED)
      setCurrentError(WarningModalTypes.INSTANCE_WEBGL_DISCONNECTED)
    })

    EngineEvents.instance.addEventListener(SocketWebRTCClientTransport.EVENTS.INSTANCE_DISCONNECTED, () => {
      updateWarningModal(WarningModalTypes.INSTANCE_DISCONNECTED)
      setCurrentError(WarningModalTypes.INSTANCE_DISCONNECTED)
    })

    EngineEvents.instance.addEventListener(SocketWebRTCClientTransport.EVENTS.INSTANCE_KICKED, ({ message }) => {
      updateWarningModal(WarningModalTypes.USER_KICKED, message)
      setCurrentError(WarningModalTypes.USER_KICKED)
    })

    EngineEvents.instance.addEventListener(SocketWebRTCClientTransport.EVENTS.CHANNEL_DISCONNECTED, () => {
      updateWarningModal(WarningModalTypes.CHANNEL_DISCONNECTED)
      setCurrentError(WarningModalTypes.CHANNEL_DISCONNECTED)
    })

    EngineEvents.instance.addEventListener(SocketWebRTCClientTransport.EVENTS.INSTANCE_RECONNECTED, () =>
      reset(WarningModalTypes.INSTANCE_DISCONNECTED)
    )

    EngineEvents.instance.addEventListener(SocketWebRTCClientTransport.EVENTS.CHANNEL_RECONNECTED, () =>
      reset(WarningModalTypes.CHANNEL_DISCONNECTED)
    )

    // If user if on Firefox in Private Browsing mode, throw error, since they can't use db storage currently
    var db = indexedDB.open('test')
    db.onerror = () => updateWarningModal(WarningModalTypes.INDEXED_DB_NOT_SUPPORTED)
  }, [])

  useEffect(() => {
    if (invalidLocationState.value) {
      updateWarningModal(WarningModalTypes.INVALID_LOCATION)
    } else {
      reset()
    }
  }, [invalidLocationState.value])

  const updateWarningModal = (type: WarningModalTypes, message?: any) => {
    const transport = Network.instance.transportHandler.getWorldTransport() as SocketWebRTCClientTransport
    switch (type) {
      case WarningModalTypes.INDEXED_DB_NOT_SUPPORTED:
        setModalValues({
          open: true,
          title: t('common:gameServer.browserError'),
          body: t('common:gameServer.browserErrorMessage'),
          noCountdown: true
        })
        break

      case WarningModalTypes.NO_GAME_SERVER_PROVISIONED:
        const currentLocation = locationState.currentLocation.location.value
        setModalValues({
          open: true,
          title: t('common:gameServer.noAvailableServers'),
          body: t('common:gameServer.noAvailableServersMessage'),
          action: async () => LocationInstanceConnectionService.provisionServer(currentLocation.id),
          parameters: [currentLocation.id, erroredInstanceId, currentLocation.sceneId],
          noCountdown: false
        })
        break

      case WarningModalTypes.INSTANCE_DISCONNECTED:
        if (!Engine.userId) return
        if (transport.left || engineState.isTeleporting.value || transport.reconnecting) return

        setModalValues({
          open: true,
          title: t('common:gameServer.worldDisconnected'),
          body: t('common:gameServer.worldDisconnectedMessage'),
          action: async () => window.location.reload(),
          timeout: 30000,
          noCountdown: false
        })
        break

      case WarningModalTypes.CHANNEL_DISCONNECTED:
        if (!Engine.userId) return
        if (transport.left || transport.reconnecting) return

        const channels = chatState.channels.channels.value
        const instanceChannel = Object.values(channels).find(
          (channel) => channel.instanceId === instanceConnectionState.instance.id.value
        )
        setModalValues({
          open: true,
          title: 'Media disconnected',
          body: "You've lost your connection with the media server. We'll try to reconnect when the following time runs out.",
          action: async () => MediaInstanceConnectionService.provisionServer(instanceChannel?.id, true),
          timeout: 15000,
          noCountdown: false
        })
        break

      case WarningModalTypes.INSTANCE_WEBGL_DISCONNECTED:
        if (transport.left || engineState.isTeleporting.value) return

        setModalValues({
          open: true,
          title: t('common:gameServer.webGLNotEnabled'),
          body: t('common:gameServer.webGLNotEnabledMessage'),
          action: async () => window.location.reload(),
          noCountdown: true
        })
        break

      case WarningModalTypes.USER_KICKED:
        setModalValues({
          open: true,
          title: t('common:gameServer.youKickedFromWorld'),
          body: `${t('common:gameServer.youKickedFromWorldMessage')}: ${message}`,
          noCountdown: true
        })
        break

      case WarningModalTypes.INVALID_LOCATION:
        setModalValues({
          open: true,
          title: t('common:gameServer.invalidLocation'),
          body: `${t('common:gameServer.cantFindLocation')} '${props.locationName}'. ${t(
            'common:gameServer.misspelledOrNotExist'
          )}`,
          noCountdown: true
        })
        break
      default:
        return
    }
  }

  const reset = (modalType?: number) => {
    if (modalType && modalType !== currentErrorRef.current) return
    setModalValues(initialModalValues)
    setCurrentError(-1)
  }

  return (
    <WarningRefreshModal
      {...modalValues}
      open={modalValues.open && !engineState.isTeleporting.value}
      handleClose={() => reset()}
    />
  )
}

export default GameServerWarnings
