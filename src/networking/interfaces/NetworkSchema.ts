import { Assemblage } from "../../common/interfaces/Assemblage"
import AssemblageAlias from "../../common/types/AssemblageAlias"

export default interface NetworkSchema {
  messagesHandlers: {
    [key: string]: {
      behavior: typeof Function
      args?: any
    }
  }
  defaultClientAssemblage: AssemblageAlias
  assemblages: { id: AssemblageAlias; assemblage: Assemblage }[]
}
