import React, { Suspense, useEffect } from 'react'

import FormDialog from '@xrengine/client-core/src/admin/common/SubmitDialog'
import { AuthService } from '@xrengine/client-core/src/user/services/AuthService'
import { userHasAccessHook } from '@xrengine/client-core/src/user/userHasAccess'
import ProjectEditor from '@xrengine/editor/src/pages/editor'

import CircularProgress from '@mui/material/CircularProgress'

const EditorProtectedRoutes = () => {
  const isSceneAllowed = userHasAccessHook('editor:write')

  useEffect(() => {
    AuthService.doLoginAuto(false)
  }, [])

  return (
    <Suspense
      fallback={
        <div
          style={{
            height: '100vh',
            width: '100%',
            textAlign: 'center',
            paddingTop: 'calc(50vh - 7px)'
          }}
        >
          <CircularProgress />
        </div>
      }
    >
      {isSceneAllowed ? <ProjectEditor /> : <FormDialog />}
    </Suspense>
  )
}

export default EditorProtectedRoutes
