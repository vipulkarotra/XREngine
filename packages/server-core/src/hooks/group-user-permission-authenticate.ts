import { BadRequest } from '@feathersjs/errors'
import { HookContext } from '@feathersjs/feathers'
import { Params } from '@feathersjs/feathers'
import _ from 'lodash'

import { extractLoggedInUserFromParams } from '../user/auth-management/auth-management.utils'

// This will attach the owner ID in the contact while creating/updating list item
export default () => {
  return async (context: HookContext): Promise<HookContext> => {
    const { params, app } = context
    const loggedInUser = extractLoggedInUserFromParams(params)
    const groupId = params.query!.groupId
    const userId = params.query!.userId || loggedInUser.id
    const paramsClone = _.cloneDeep(context.params)
    paramsClone.provider = null!
    if (params.groupUsersRemoved !== true) {
      const groupUserResult = await app.service('group-user').find({
        query: {
          groupId: groupId,
          userId: userId
        }
      })
      if (groupUserResult.total === 0) {
        throw new BadRequest('Invalid group ID in group-user-permission')
      }
    }
    return context
  }
}
