import { client } from '@xrengine/client-core/src/feathers'
import { store } from '@xrengine/client-core/src/store'
import { MultiError } from '@xrengine/client-core/src/util/errors'
import { ProjectInterface } from '@xrengine/common/src/interfaces/ProjectInterface'
import { SceneJson } from '@xrengine/common/src/interfaces/SceneInterface'
import { AnimationManager } from '@xrengine/engine/src/avatar/AnimationManager'
import TransformGizmo from '@xrengine/engine/src/scene/classes/TransformGizmo'

import ErrorIcon from '../classes/ErrorIcon'
import { clearHistory, executeCommand } from '../classes/History'
import EditorCommands from '../constants/EditorCommands'
import { removeInputEvents } from '../controls/InputEvents'
import { disposePlayModeControls } from '../controls/PlayModeControls'
import { copy, paste } from '../functions/copyPaste'
import { EditorErrorAction } from '../services/EditorErrorServices'
import { accessEditorState, EditorAction, TaskStatus } from '../services/EditorServices'
import { SelectionAction } from '../services/SelectionServices'
import { disposeScene, initializeScene } from './sceneRenderFunctions'

/**
 * Gets a list of projects installed
 * @returns {ProjectInterface[]}
 */
export const getProjects = async (): Promise<ProjectInterface[]> => {
  try {
    const { data } = await client.service('project').find()
    return data
  } catch (error) {
    throw new Error(error)
  }
}

/**
 * Saves a project
 * @param projectName
 */
export const saveProject = async (projectName: string) => {
  try {
    await client.service('project').patch(projectName, null!)
  } catch (error) {
    console.log('Error saving project', projectName)
    throw new Error(error)
  }
}

/**
 * Runs tasks require prior to the project load.
 */
export async function runPreprojectLoadTasks(): Promise<void> {
  const editorState = accessEditorState()

  if (editorState.preprojectLoadTaskStatus.value === TaskStatus.NOT_STARTED) {
    store.dispatch(EditorAction.updatePreprojectLoadTask(TaskStatus.IN_PROGRESS))

    await Promise.all([ErrorIcon.load(), TransformGizmo.load(), AnimationManager.instance.getDefaultAnimations()])

    store.dispatch(EditorAction.updatePreprojectLoadTask(TaskStatus.COMPLETED))
  }
}

/**
 * Loads scene from provided project file.
 */
export async function loadProjectScene(projectFile: SceneJson) {
  disposeProject()

  await runPreprojectLoadTasks()

  removeInputEvents()
  disposePlayModeControls()
  const errors = await initializeScene(projectFile)

  executeCommand(EditorCommands.REPLACE_SELECTION, [])
  clearHistory()

  store.dispatch(EditorAction.projectLoaded(true))
  store.dispatch(SelectionAction.changedSceneGraph())

  if (errors && errors.length > 0) {
    const error = new MultiError('Errors loading project', errors)
    store.dispatch(EditorErrorAction.throwError(error))
    throw error
  }

  window.addEventListener('copy', copy)
  window.addEventListener('paste', paste)
}

/**
 * Disposes project data
 */
export function disposeProject() {
  disposeScene()
  removeInputEvents()
  disposePlayModeControls()
  store.dispatch(EditorAction.projectLoaded(false))

  window.addEventListener('copy', copy)
  window.addEventListener('paste', paste)
}
