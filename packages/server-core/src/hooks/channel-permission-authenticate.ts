import { BadRequest, Forbidden } from '@feathersjs/errors'
import { HookContext } from '@feathersjs/feathers'

import { extractLoggedInUserFromParams } from '../user/auth-management/auth-management.utils'
import { Application } from './../../declarations.d'

// This will attach the owner ID in the contact while creating/updating list item
export default () => {
  return async (context: HookContext): Promise<HookContext> => {
    const { params, app } = context
    console.log(params.query)
    const loggedInUser = extractLoggedInUserFromParams(params)
    const userId = loggedInUser.id
    if (!params.query!.channelId) {
      throw new BadRequest('Must provide a channel ID')
    }
    const channel = await app.service('channel').get(params.query!.channelId)
    if (channel == null) {
      throw new BadRequest('Invalid channel ID')
    }
    if (channel.channelType === 'user') {
      if (channel.userId1 !== userId && channel.userId2 !== userId) {
        throw new Forbidden('You are not a member of that channel')
      }
    } else if (channel.channelType === 'group') {
      const groupUser = await (app as Application).service('group-user').Model.findOne({
        where: {
          groupId: channel.groupId,
          userId: userId
        }
      })
      if (groupUser == null) {
        throw new Forbidden('You are not a member of that channel')
      }
    } else if (channel.channelType === 'party') {
      const partyUser = await (app as Application).service('party-user').Model.findOne({
        where: {
          partyId: channel.partyId,
          userId: userId
        }
      })
      if (partyUser == null) {
        throw new Forbidden('You are not a member of that channel')
      }
    }
    return context
  }
}
