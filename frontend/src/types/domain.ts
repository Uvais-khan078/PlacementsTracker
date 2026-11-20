export const APPLICATION_ROLES = ['SUPER_ADMIN', 'COMMITTEE_MEMBER'] as const;
export type ApplicationRole = (typeof APPLICATION_ROLES)[number];
export type ModuleAccess = 'NONE' | 'READ' | 'WRITE';
export type ModulePermissions = Record<string, ModuleAccess>;

export type MemberProfile = {
  userId: string;
  loginId: string;
  fullName: string;
  email: string;
  role: ApplicationRole;
  isActive: boolean;
  permissions: ModulePermissions;
};

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; userEmail: string; profile: MemberProfile | null; profileStatus: 'pending' | 'missing' };
