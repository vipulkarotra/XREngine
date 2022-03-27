import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useHistory } from 'react-router-dom'

import { useDispatch } from '@xrengine/client-core/src/store'
import { SceneData } from '@xrengine/common/src/interfaces/SceneInterface'

import { MoreVert } from '@mui/icons-material'
import { IconButton, InputBase, Menu, MenuItem, Paper } from '@mui/material'

import { deleteScene, getScenes, renameScene } from '../../functions/sceneFunctions'
import { EditorAction, useEditorState } from '../../services/EditorServices'
import { Button } from '../inputs/Button'
import { InfoTooltip } from '../layout/Tooltip'
import { DeleteDialog } from '../projects/DeleteDialog'
import styles from './styles.module.scss'

/**
 * Displays the scenes that exist in the current project.
 * @author Josh Field
 */
export default function ScenesPanel({ loadScene, newScene, toggleRefetchScenes }) {
  const { t } = useTranslation()
  const panelRef = useRef(null)
  const [scenes, setScenes] = useState<SceneData[]>([])
  const [isContextMenuOpen, setContextMenuOpen] = useState(false)
  const [isDeleteOpen, setDeleteOpen] = useState(false)
  const [anchorEl, setAnchorEl] = useState(null)
  const [newName, setNewName] = useState('')
  const [isRenaming, setRenaming] = useState(false)
  const [activeScene, setActiveScene] = useState<SceneData | null>(null)
  const dispatch = useDispatch()
  const history = useHistory()
  const editorState = useEditorState()

  const fetchItems = async () => {
    try {
      const data = await getScenes(editorState.projectName.value!)
      setScenes(data ?? [])
    } catch (error) {
      console.error(error)
    }
  }

  useEffect(() => {
    fetchItems()
  }, [toggleRefetchScenes])

  const onCreateScene = async () => {
    await newScene()
    fetchItems()
  }

  const onClickExisting = async (e, scene) => {
    e.preventDefault()
    loadScene(scene.name)
    fetchItems()
  }

  const openDeleteDialog = () => {
    setContextMenuOpen(false)
    setAnchorEl(null)
    setDeleteOpen(true)
  }

  const closeDeleteDialog = () => {
    setActiveScene(null)
    setDeleteOpen(false)
  }

  const deleteActiveScene = async () => {
    if (activeScene) {
      await deleteScene(editorState.projectName.value, activeScene.name)
      if (editorState.sceneName.value === activeScene.name) {
        dispatch(EditorAction.sceneChanged(null))
        history.push(`/editor/${editorState.projectName.value}`)
      }

      fetchItems()
    }

    closeDeleteDialog()
  }

  const openContextMenu = (e, scene) => {
    e.stopPropagation()
    setActiveScene(scene)
    setContextMenuOpen(true)
    setAnchorEl(e.target)
  }

  const closeContextMenu = () => {
    setContextMenuOpen(false)
    setAnchorEl(null)
    setActiveScene(null)
  }

  const startRenaming = () => {
    setContextMenuOpen(false)
    setAnchorEl(null)
    setRenaming(true)
    setNewName(activeScene!.name)
  }

  const renameSceneToNewName = async (e) => {
    if (e.key == 'Enter' && activeScene) {
      await renameScene(editorState.projectName.value as string, newName, activeScene.name)
      dispatch(EditorAction.sceneChanged(newName))
      history.push(`/editor/${editorState.projectName.value}/${newName}`)
      setRenaming(false)
      setNewName('')
      fetchItems()
    }
  }

  return (
    <>
      <div ref={panelRef} id="file-browser-panel" className={styles.panelContainer}>
        <div className={styles.btnContainer}>
          <Button onClick={onCreateScene} className={styles.newBtn}>
            {t(`editor:newScene`)}
          </Button>
        </div>
        <div className={styles.contentContainer + ' ' + styles.sceneGridContainer}>
          {scenes.map((scene, i) => {
            return (
              <div className={styles.sceneContainer} key={i}>
                <a onClick={(e) => onClickExisting(e, scene)}>
                  <div className={styles.thumbnailContainer}>
                    <img src={scene.thumbnailUrl} alt="" />
                  </div>
                  <div className={styles.detailBlock}>
                    {activeScene === scene && isRenaming ? (
                      <Paper component="div" className={styles.inputContainer}>
                        <InputBase
                          className={styles.input}
                          name="name"
                          style={{ color: '#fff' }}
                          autoComplete="off"
                          autoFocus
                          value={newName}
                          onClick={(e) => {
                            e.stopPropagation()
                          }}
                          onChange={(e) => setNewName(e.target.value)}
                          onKeyPress={renameSceneToNewName}
                        />
                      </Paper>
                    ) : (
                      <InfoTooltip title={scene.name}>
                        <span>{scene.name}</span>
                      </InfoTooltip>
                    )}
                    <IconButton onClick={(e) => openContextMenu(e, scene)}>
                      <MoreVert />
                    </IconButton>
                  </div>
                </a>
              </div>
            )
          })}
        </div>
      </div>
      <Menu
        id="menu"
        MenuListProps={{ 'aria-labelledby': 'long-button' }}
        anchorEl={anchorEl}
        open={isContextMenuOpen}
        onClose={closeContextMenu}
        classes={{ paper: styles.sceneContextMenu }}
      >
        <MenuItem classes={{ root: styles.menuItem }} onClick={startRenaming}>
          {t('editor:hierarchy.lbl-rename')}
        </MenuItem>
        <MenuItem classes={{ root: styles.menuItem }} onClick={openDeleteDialog}>
          {t('editor:hierarchy.lbl-delete')}
        </MenuItem>
      </Menu>
      <DeleteDialog
        open={isDeleteOpen}
        onClose={closeDeleteDialog}
        onCancel={closeDeleteDialog}
        onConfirm={deleteActiveScene}
      />
    </>
  )
}
