import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api';

type Member = { userId: string; loginId: string; fullName: string; isActive: boolean };
export default function MemberAssignmentField({ isSuperAdmin, value, onChange }: { isSuperAdmin: boolean; value: string; onChange: (memberId: string) => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => { if (isSuperAdmin) apiRequest<Member[]>('/members').then((rows) => setMembers(rows.filter((row) => row.isActive))).catch(() => setMembers([])); }, [isSuperAdmin]);
  if (!isSuperAdmin) return null;
  return <label>Assign to<select value={value} onChange={(event) => onChange(event.target.value)}><option value="">My account</option>{members.map((member) => <option key={member.userId} value={member.userId}>{member.loginId} · {member.fullName}</option>)}</select></label>;
}
