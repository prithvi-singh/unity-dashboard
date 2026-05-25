'use client';

import Link from 'next/link';
import type { UserProfileRole } from '@/lib/types';
import { buildUserProfileUrl, type ProfileLinkParams } from '@/lib/userProfile';

interface Props {
  userId: number;
  role: UserProfileRole;
  params?: ProfileLinkParams;
  className?: string;
  children: React.ReactNode;
}

export default function UserProfileLink({ userId, role, params, className, children }: Props) {
  const href = buildUserProfileUrl(userId, role, params);
  return (
    <Link
      href={href}
      className={className ?? 'text-blue-600 hover:underline underline-offset-2 transition-colors'}
    >
      {children}
    </Link>
  );
}
