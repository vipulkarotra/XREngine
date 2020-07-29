import { Service, SequelizeServiceOptions } from 'feathers-sequelize'
import { Application } from '../../declarations'
import { Params } from '@feathersjs/feathers'
import { extractLoggedInUserFromParams } from '../auth-management/auth-management.utils'
import { Op, Sequelize } from 'sequelize'

export class Channel extends Service {
  app: Application
  constructor (options: Partial<SequelizeServiceOptions>, app: Application) {
    super(options)
    this.app = app
  }

  async find(params: Params): Promise<any> {
    console.log('CHANNEL FIND')
    console.log(params)
    const { query } = params
    const skip = query?.skip || 0
    const limit = query?.limit || 10
    const loggedInUser = extractLoggedInUserFromParams(params)
    const userId = loggedInUser.userId
    console.log(query)
    const Model = this.app.service('channel').Model
    console.log(Model.associations)
    try {
      const results = await Model.findAndCountAll({
        subQuery: false,
        offset: skip,
        limit: limit,
        order: [
          ['updatedAt', 'DESC']
        ],
        include: [
          'user1',
          'user2',
          {
            model: this.app.service('group').Model,
            include: [
              {
                model: this.app.service('group-user').Model,
                include: [
                  {
                    model: this.app.service('user').Model
                  }
                ]
              }
            ]
          },
          {
            model: this.app.service('party').Model,
            include: [
              {
                model: this.app.service('party-user').Model,
                include: [
                  {
                    model: this.app.service('user').Model
                  }
                ]
              }
            ]
          }
        ],
        where: {
          [Op.or]: [
            {
              [Op.or]: [
                {
                  userId1: userId
                },
                {
                  userId2: userId
                }
              ]
            },
            {
              '$group.group_users.userId$': userId
            },
            {
              '$party.party_users.userId$': userId
            }
          ]
        },
      })

      await Promise.all(results.rows.map(async (channel) => {
        return new Promise(async (resolve) => {
          if (channel.channelType === 'user') {
            const user1AvatarResult = await this.app.service('static-resource').find({
              query: {
                staticResourceType: 'user-thumbnail',
                userId: channel.userId1
              }
            }) as any

            const user2AvatarResult = await this.app.service('static-resource').find({
              query: {
                staticResourceType: 'user-thumbnail',
                userId: channel.userId2
              }
            }) as any

            if (user1AvatarResult.total > 0) {
              channel.user1.dataValues.avatarUrl = user1AvatarResult.data[0].url
            }

            if (user2AvatarResult.total > 0) {
              channel.user2.dataValues.avatarUrl = user2AvatarResult.data[0].url
            }

            resolve()
          }
          else if (channel.channelType === 'group') {
            const groupUsers = await this.app.service('group-user').Model.findAll({
              limit: 1000,
              where: {
                groupId: channel.groupId
              },
              include: [
                {
                  model: this.app.service('user').Model
                }
              ]
            })
            await Promise.all(groupUsers.map(async (groupUser) => {
              const avatarResult = await this.app.service('static-resource').find({
                query: {
                  staticResourceType: 'user-thumbnail',
                  userId: groupUser.userId
                }
              }) as any

              if (avatarResult.total > 0) {
                groupUser.dataValues.user.dataValues.avatarUrl = avatarResult.data[0].url
              }

              return Promise.resolve()
            }))

            channel.group.dataValues.groupUsers = groupUsers
            resolve()
          }
          else if (channel.channelType === 'party') {
            const partyUsers = await this.app.service('party-user').Model.findAll({
              limit: 1000,
              where: {
                partyId: channel.partyId
              },
              include: [
                {
                  model: this.app.service('user').Model
                }
              ]
            })
            await Promise.all(partyUsers.map(async (partyUser) => {
              const avatarResult = await this.app.service('static-resource').find({
                query: {
                  staticResourceType: 'user-thumbnail',
                  userId: partyUser.userId
                }
              }) as any

              if (avatarResult.total > 0) {
                partyUser.dataValues.user.dataValues.avatarUrl = avatarResult.data[0].url
              }

              return Promise.resolve()
            }))
            channel.party.dataValues.partyUsers = partyUsers
            resolve()
          }
        })
      }))

      return {
        data: results.rows,
        total: results.count,
        skip: skip,
        limit: limit
      }
    } catch(err) {
      console.log('Channel find failed')
      console.log(err)
      throw err
    }
  }
}
