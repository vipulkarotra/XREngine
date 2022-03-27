import { Params } from '@feathersjs/feathers'
import express from 'express'
import _ from 'lodash'
import multer from 'multer'

import { AdminAssetUploadArgumentsType, AssetUploadType } from '@xrengine/common/src/interfaces/UploadAssetInterface'

import { Application } from '../../../declarations'
import restrictUserRole from '../../hooks/restrict-user-role'
import { AvatarUploadArguments } from '../../user/avatar/avatar-helper'
import { getCachedAsset } from '../storageprovider/getCachedAsset'
import { useStorageProvider } from '../storageprovider/storageprovider'
import hooks from './upload-asset.hooks'

const multipartMiddleware = multer({ limits: { fieldSize: Infinity } })

declare module '@xrengine/common/declarations' {
  interface ServiceTypes {
    'upload-asset': any
  }
}

export const addGenericAssetToS3AndStaticResources = async (
  app: Application,
  file: Buffer,
  args: AdminAssetUploadArgumentsType
) => {
  const provider = useStorageProvider()
  // make userId optional and safe for feathers create
  const userIdQuery = args.userId ? { userId: args.userId } : {}
  const key = args.key
  const existingAsset = await app.service('static-resource').Model.findAndCountAll({
    where: {
      staticResourceType: args.staticResourceType || 'avatar',
      ...(args.name ? { name: args.name } : { key: key }),
      ...userIdQuery
    }
  })

  const promises: Promise<any>[] = []

  // upload asset to storage provider
  promises.push(
    new Promise<void>(async (resolve) => {
      await provider.createInvalidation([key])
      await provider.putObject({
        Key: key,
        Body: file,
        ContentType: args.contentType
      })
      resolve()
    })
  )

  // add asset to static resources
  const assetURL = getCachedAsset(key, provider.cacheDomain)
  if (existingAsset.rows.length) {
    promises.push(provider.deleteResources([existingAsset.rows[0].id]))
    promises.push(
      app.service('static-resource').patch(
        existingAsset.rows[0].id,
        {
          url: assetURL,
          key: key
        },
        { isInternal: true }
      )
    )
  } else {
    promises.push(
      app.service('static-resource').create(
        {
          name: args.name ?? null,
          mimeType: args.contentType,
          url: assetURL,
          key: key,
          staticResourceType: args.staticResourceType,
          ...userIdQuery
        },
        { isInternal: true }
      )
    )
  }
  await Promise.all(promises)
  return assetURL
}

export default (app: Application): void => {
  app.use(
    'upload-asset',
    multipartMiddleware.any(),
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req?.feathers && req.method !== 'GET') {
        req.feathers.files = (req as any).files.media ? (req as any).files.media : (req as any).files
        req.feathers.args = (req as any).args
      }
      next()
    },
    {
      create: async (data: AssetUploadType, params?: Params) => {
        console.log('\n\nupload-asset', data, '\n\n')
        // console.log(params)
        if (data.type === 'user-avatar-upload') {
          return await app.service('avatar').create(
            {
              avatar: data.files[0],
              thumbnail: data.files[1],
              ...data.args
            } as AvatarUploadArguments,
            null!
          )
        } else if (data.type === 'admin-file-upload') {
          if (!(await restrictUserRole('admin')({ app, params } as any))) return
          const argsData = typeof data.args === 'string' ? JSON.parse(data.args) : data.args
          if (params && params.files && params.files.length > 0) {
            return Promise.all(
              params?.files.map((file, i) =>
                addGenericAssetToS3AndStaticResources(app, file.buffer as Buffer, { ...argsData[i] })
              )
            )
          } else {
            return Promise.all(
              data?.files.map((file, i) =>
                addGenericAssetToS3AndStaticResources(app, file as Buffer, { ...argsData[0] })
              )
            )
          }
        }
      }
    }
  )
  const service = app.service('upload-asset')
  ;(service as any).hooks(hooks)
}
