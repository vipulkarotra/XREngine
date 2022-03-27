import { Params } from '@feathersjs/feathers'
import appRootPath from 'app-root-path'
import fs from 'fs'
import path from 'path'

import { SceneData } from '@xrengine/common/src/interfaces/SceneInterface'

import { Application } from '../../../declarations'
import { getAllPortals, getCubemapBake, getPortal } from './scene-helper'
import { getSceneData, Scene } from './scene.class'
import projectDocs from './scene.docs'
import hooks from './scene.hooks'

declare module '@xrengine/common/declarations' {
  interface ServiceTypes {
    scene: Scene
  }
  interface ServiceTypes {
    portal: any
  }
  interface ServiceTypes {
    scenes: {
      get: ReturnType<typeof getScenesForProject>
      find: ReturnType<typeof getAllScenes>
    }
  }
}

type GetScenesArgsType = {
  projectName: string
  metadataOnly: boolean
  internal?: boolean
}

export const getScenesForProject = (app: Application) => {
  return async function (args: GetScenesArgsType, params?: Params): Promise<{ data: SceneData[] }> {
    const { projectName, metadataOnly, internal } = args
    try {
      const project = await app.service('project').get(projectName, params)
      if (!project || !project.data) throw new Error(`No project named ${projectName} exists`)

      const newSceneJsonPath = path.resolve(appRootPath.path, `packages/projects/projects/${projectName}`)

      const files = fs
        .readdirSync(newSceneJsonPath, { withFileTypes: true })
        .filter((dirent) => !dirent.isDirectory())
        .map((dirent) => dirent.name)
        .filter((name) => name.endsWith('.scene.json'))
        .map((name) => name.slice(0, -'.scene.json'.length))

      const sceneData: SceneData[] = files.map((sceneName) =>
        getSceneData(projectName, sceneName, metadataOnly, internal)
      )

      return {
        data: sceneData
      }
    } catch (e) {
      console.log(e)
      return null!
    }
  }
}

export const getAllScenes = (app: Application) => {
  return async function (params: Params): Promise<{ data: SceneData[] }> {
    const projects = await app.service('project').find(params)
    const scenes = await Promise.all(
      projects.data.map(
        (project) =>
          new Promise<SceneData[]>(async (resolve) => {
            const projectScenes = (
              await getScenesForProject(app)(
                { projectName: project.name, metadataOnly: params.metadataOnly, internal: params.provider == null },
                params
              )
            ).data
            projectScenes.forEach((scene) => (scene.project = project.name))
            resolve(projectScenes)
          })
      )
    )
    return {
      data: scenes.flat()
    }
  }
}

export default (app: Application) => {
  /**
   * Initialize our service with any options it requires and docs
   *
   * @author Vyacheslav Solovjov
   */
  const event = new Scene(app)
  event.docs = projectDocs

  app.use('scene', event)

  app.use('scenes', {
    get: getScenesForProject(app),
    find: getAllScenes(app)
  })

  app.use('portal', {
    get: getPortal(app),
    find: getAllPortals(app)
  })
  app.use('/cubemap/:entityId', getCubemapBake(app))

  /**
   * Get our initialized service so that we can register hooks
   *
   * @author Vyacheslav Solovjov
   */
  const service = app.service('scene')

  service.hooks(hooks)
}
