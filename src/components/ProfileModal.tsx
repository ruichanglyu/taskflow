import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Camera, Check, AlertCircle, Download, Eye, EyeOff, Mail, Lock, User as UserIcon, Calendar } from 'lucide-react';
import { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { cn } from '../utils/cn';
import { Task, Deadline, Project } from '../types';

interface ProfileModalProps {
  user: User;
  open: boolean;
  onClose: () => void;
  tasks: Task[];
  deadlines: Deadline[];
  projects: Project[];
  onUserUpdated: () => void;
}

type Tab = 'profile' | 'security' | 'data';

export function ProfileModal({ user, open, onClose, tasks, deadlines, projects, onUserUpdated }: ProfileModalProps) {
  const [tab, setTab] = useState<Tab>('profile');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Profile fields
  const [displayName, setDisplayName] = useState(user.user_metadata?.full_name || '');
  const [avatarUrl, setAvatarUrl] = useState<string>(user.user_metadata?.avatar_url || '');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Email change
  const [newEmail, setNewEmail] = useState('');

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

  const clearMessage = () => setMessage(null);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  // ── Save display name ──
  const handleSaveName = async () => {
    if (!supabase || !displayName.trim()) return;
    setSaving(true);
    clearMessage();
    const { error } = await supabase.auth.updateUser({
      data: { full_name: displayName.trim() },
    });
    setSaving(false);
    if (error) {
      showMessage('error', error.message);
    } else {
      showMessage('success', 'Display name updated.');
      onUserUpdated();
    }
  };

  // ── Upload avatar ──
  const handleAvatarUpload = async (file: File) => {
    if (!supabase) return;
    setUploadingAvatar(true);
    clearMessage();

    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `${user.id}/avatar.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true });

    if (uploadErr) {
      setUploadingAvatar(false);
      showMessage('error', 'Could not upload photo. Make sure the "avatars" storage bucket exists.');
      return;
    }

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
    const publicUrl = urlData.publicUrl + '?t=' + Date.now(); // cache bust

    const { error: updateErr } = await supabase.auth.updateUser({
      data: { avatar_url: publicUrl },
    });

    setUploadingAvatar(false);
    if (updateErr) {
      showMessage('error', updateErr.message);
    } else {
      setAvatarUrl(publicUrl);
      showMessage('success', 'Profile picture updated.');
      onUserUpdated();
    }
  };

  // ── Change email ──
  const handleChangeEmail = async () => {
    if (!supabase || !newEmail.trim()) return;
    setSaving(true);
    clearMessage();
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    setSaving(false);
    if (error) {
      showMessage('error', error.message);
    } else {
      showMessage('success', 'Verification email sent to your new address. Check your inbox.');
      setNewEmail('');
    }
  };

  // ── Change password ──
  const handleChangePassword = async () => {
    if (!supabase) return;
    if (newPassword.length < 6) {
      showMessage('error', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showMessage('error', 'New passwords do not match.');
      return;
    }

    setSaving(true);
    clearMessage();

    // Verify current password by attempting sign-in
    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password: currentPassword,
    });

    if (verifyErr) {
      setSaving(false);
      showMessage('error', 'Current password is incorrect.');
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);

    if (error) {
      showMessage('error', error.message);
    } else {
      showMessage('success', 'Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  // ── Export data as CSV ──
  const exportData = useCallback(() => {
    // Tasks CSV
    const taskRows = [
      ['Title', 'Status', 'Priority', 'Course', 'Due Date', 'Recurrence', 'Created'].join(','),
      ...tasks.map(t => {
        const course = projects.find(p => p.id === t.projectId);
        return [
          `"${t.title.replace(/"/g, '""')}"`,
          t.status,
          t.priority,
          `"${course?.name ?? ''}"`,
          t.dueDate ?? '',
          t.recurrence,
          t.createdAt,
        ].join(',');
      }),
    ].join('\n');

    // Deadlines CSV
    const deadlineRows = [
      ['Title', 'Type', 'Status', 'Course', 'Due Date', 'Due Time', 'Notes'].join(','),
      ...deadlines.map(d => {
        const course = projects.find(p => p.id === d.projectId);
        return [
          `"${d.title.replace(/"/g, '""')}"`,
          d.type,
          d.status,
          `"${course?.name ?? ''}"`,
          d.dueDate,
          d.dueTime ?? '',
          `"${(d.notes ?? '').replace(/"/g, '""')}"`,
        ].join(',');
      }),
    ].join('\n');

    // Courses CSV
    const courseRows = [
      ['Name', 'Color', 'Created'].join(','),
      ...projects.map(p => [
        `"${p.name.replace(/"/g, '""')}"`,
        p.color,
        p.createdAt,
      ].join(',')),
    ].join('\n');

    const combined = `=== TASKS ===\n${taskRows}\n\n=== DEADLINES ===\n${deadlineRows}\n\n=== COURSES ===\n${courseRows}`;

    const blob = new Blob([combined], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `taskflow-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showMessage('success', 'Data exported successfully.');
  }, [tasks, deadlines, projects]);

  if (!open) return null;

  const initials = (displayName || user.email?.split('@')[0] || 'U').charAt(0).toUpperCase();
  const memberSince = new Date(user.created_at).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const tabs: { id: Tab; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'security', label: 'Security' },
    { id: 'data', label: 'Data' },
  ];

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        <div
          className="w-full max-w-lg overflow-hidden rounded-3xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          {/* Header with avatar */}
          <div className="relative border-b border-[var(--border-soft)] px-6 pb-5 pt-6">
            <button
              onClick={onClose}
              className="absolute right-4 top-4 rounded-xl p-1.5 text-[var(--text-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-4">
              {/* Avatar */}
              <div className="relative group">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Avatar"
                    className="h-16 w-16 rounded-2xl object-cover"
                  />
                ) : (
                  <div
                    className="flex h-16 w-16 items-center justify-center rounded-2xl text-xl font-bold text-white"
                    style={{ backgroundImage: 'var(--avatar-gradient)' }}
                  >
                    {initials}
                  </div>
                )}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40 opacity-0 transition group-hover:opacity-100"
                >
                  <Camera size={20} className="text-white" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleAvatarUpload(file);
                    e.target.value = '';
                  }}
                />
                {uploadingAvatar && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/50">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  </div>
                )}
              </div>

              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                  {displayName || user.email?.split('@')[0] || 'User'}
                </h2>
                <p className="text-sm text-[var(--text-muted)]">{user.email}</p>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--text-faint)]">
                  <Calendar size={12} />
                  Member since {memberSince}
                </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-[var(--border-soft)]">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); clearMessage(); }}
                className={cn(
                  'flex-1 px-4 py-3 text-sm font-medium transition',
                  tab === t.id
                    ? 'border-b-2 border-[var(--accent)] text-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Message */}
          {message && (
            <div className={cn(
              'mx-6 mt-4 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm',
              message.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-red-500/10 text-red-400'
            )}>
              {message.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
              {message.text}
            </div>
          )}

          {/* Tab content */}
          <div className="max-h-[50vh] overflow-y-auto px-6 py-5">
            {tab === 'profile' && (
              <div className="space-y-5">
                {/* Display name */}
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--text-faint)]">
                    <UserIcon size={12} />
                    Display Name
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={displayName}
                      onChange={e => setDisplayName(e.target.value)}
                      placeholder="Your name"
                      className="flex-1 rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                    />
                    <button
                      onClick={handleSaveName}
                      disabled={saving || displayName.trim() === (user.user_metadata?.full_name || '')}
                      className="rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition disabled:opacity-40"
                      style={{ backgroundColor: 'var(--accent-strong)' }}
                    >
                      Save
                    </button>
                  </div>
                </div>

                {/* Email */}
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--text-faint)]">
                    <Mail size={12} />
                    Email Address
                  </label>
                  <p className="mb-2 text-sm text-[var(--text-secondary)]">{user.email}</p>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={newEmail}
                      onChange={e => setNewEmail(e.target.value)}
                      placeholder="New email address"
                      className="flex-1 rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                    />
                    <button
                      onClick={handleChangeEmail}
                      disabled={saving || !newEmail.trim()}
                      className="rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition disabled:opacity-40"
                      style={{ backgroundColor: 'var(--accent-strong)' }}
                    >
                      Update
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-[var(--text-faint)]">
                    A verification link will be sent to your new email.
                  </p>
                </div>

                {/* Account info */}
                <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--text-faint)]">Account Info</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[var(--text-muted)]">User ID</span>
                      <span className="font-mono text-xs text-[var(--text-faint)]">{user.id.slice(0, 8)}...</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-muted)]">Member since</span>
                      <span className="text-[var(--text-secondary)]">{memberSince}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-muted)]">Tasks</span>
                      <span className="text-[var(--text-secondary)]">{tasks.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-muted)]">Deadlines</span>
                      <span className="text-[var(--text-secondary)]">{deadlines.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-muted)]">Courses</span>
                      <span className="text-[var(--text-secondary)]">{projects.length}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === 'security' && (
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--text-faint)]">
                    <Lock size={12} />
                    Change Password
                  </label>
                  <div className="space-y-2.5">
                    <div className="relative">
                      <input
                        type={showCurrentPw ? 'text' : 'password'}
                        value={currentPassword}
                        onChange={e => setCurrentPassword(e.target.value)}
                        placeholder="Current password"
                        className="w-full rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2.5 pr-10 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPw(!showCurrentPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)] hover:text-[var(--text-muted)]"
                      >
                        {showCurrentPw ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showNewPw ? 'text' : 'password'}
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        placeholder="New password (min 6 characters)"
                        className="w-full rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2.5 pr-10 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPw(!showNewPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)] hover:text-[var(--text-muted)]"
                      >
                        {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      className="w-full rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                    />
                    <button
                      onClick={handleChangePassword}
                      disabled={saving || !currentPassword || !newPassword || !confirmPassword}
                      className="w-full rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition disabled:opacity-40"
                      style={{ backgroundColor: 'var(--accent-strong)' }}
                    >
                      {saving ? 'Updating...' : 'Update Password'}
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-4">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--text-faint)]">Security Info</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[var(--text-muted)]">Auth provider</span>
                      <span className="text-[var(--text-secondary)]">{user.app_metadata?.provider ?? 'email'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-muted)]">Last sign in</span>
                      <span className="text-[var(--text-secondary)]">
                        {user.last_sign_in_at
                          ? new Date(user.last_sign_in_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                          : 'Unknown'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === 'data' && (
              <div className="space-y-5">
                <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-4">
                  <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Your Data</h3>
                  <p className="mb-1 text-sm text-[var(--text-muted)]">
                    Export all your tasks, deadlines, and courses as a CSV file.
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-3">
                      <div className="text-lg font-bold text-[var(--text-primary)]">{tasks.length}</div>
                      <div className="text-[11px] text-[var(--text-faint)]">Tasks</div>
                    </div>
                    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-3">
                      <div className="text-lg font-bold text-[var(--text-primary)]">{deadlines.length}</div>
                      <div className="text-[11px] text-[var(--text-faint)]">Deadlines</div>
                    </div>
                    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-3">
                      <div className="text-lg font-bold text-[var(--text-primary)]">{projects.length}</div>
                      <div className="text-[11px] text-[var(--text-faint)]">Courses</div>
                    </div>
                  </div>
                </div>

                <button
                  onClick={exportData}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--border-strong)]"
                >
                  <Download size={16} />
                  Export All Data as CSV
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
