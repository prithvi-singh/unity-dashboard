'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import type { UserProfileRole } from '@/lib/types';
import { buildUserProfileUrl, type ProfileLinkParams } from '@/lib/userProfile';

interface Props {
  userId: number;
  role: UserProfileRole;
  params?: ProfileLinkParams;
  className?: string;
  /** Supply to enable the tooltip "View [firstName]'s profile →" */
  firstName?: string;
  children: React.ReactNode;
}

/**
 * Wraps any content in a profile link.
 * When `firstName` is provided, shows a "View [name]'s profile →" tooltip
 * with a 300 ms delay, matching the PersonLink spec.
 */
export default function UserProfileLink({
  userId,
  role,
  params,
  className,
  firstName,
  children,
}: Props) {
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const href = buildUserProfileUrl(userId, role, params);

  const handleEnter = useCallback(() => {
    if (!firstName) return;
    timerRef.current = setTimeout(() => setShow(true), 300);
  }, [firstName]);

  const handleLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setShow(false);
  }, []);

  return (
    <span
      className="relative inline-block"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <Link
        href={href}
        className={className ?? 'person-link'}
      >
        {children}
      </Link>
      {show && firstName && (
        <span
          className="person-link-tooltip"
          role="tooltip"
          aria-hidden="true"
        >
          View {firstName}&apos;s profile →
        </span>
      )}
    </span>
  );
}
