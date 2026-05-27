'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import type { UserProfileRole } from '@/lib/types';
import { buildUserProfileUrl, type ProfileLinkParams } from '@/lib/userProfile';

interface PersonLinkProps {
  userId: number;
  role: UserProfileRole;
  firstName: string;
  lastName: string;
  params?: ProfileLinkParams;
  className?: string;
}

/**
 * Clickable person name with dotted underline, solid-on-hover transition,
 * and a dark pill tooltip "View [First name]'s profile →" after 300 ms.
 * Navigates to /users/[userId] in the same tab.
 */
export default function PersonLink({
  userId,
  role,
  firstName,
  lastName,
  params,
  className,
}: PersonLinkProps) {
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const href = buildUserProfileUrl(userId, role, params ?? {});

  const handleEnter = useCallback(() => {
    timerRef.current = setTimeout(() => setShow(true), 300);
  }, []);

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
        className={`person-link${className ? ` ${className}` : ''}`}
        aria-label={`View ${firstName} ${lastName}'s profile`}
      >
        {firstName} {lastName}
      </Link>
      {show && (
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
