import {
  type StoredOAuthTokens,
  type OAuthSession,
  HahaOAuthService,
} from './hahaOAuthService'

const CCTOOLS_STORAGE_DIR = 'cc-tools'

export { type StoredOAuthTokens }
export { type OAuthSession }
export class CCToolsOAuthService extends HahaOAuthService {
  constructor() {
    super({ storageDir: CCTOOLS_STORAGE_DIR })
  }
}
export const cctoolsOAuthService = new CCToolsOAuthService()
