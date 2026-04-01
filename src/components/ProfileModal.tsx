import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Camera, Check, AlertCircle, Download, Eye, EyeOff, Mail, Lock, User as UserIcon, Calendar, Sparkles, Trash2, Moon, Sunrise, Sunset, Fingerprint, ZoomIn, ZoomOut, RotateCw, ChevronDown } from 'lucide-react';
import { User } from '@supabase/supabase-js';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import { supabase } from '../lib/supabase';
import { cn } from '../utils/cn';
import { Task, Deadline, Project } from '../types';
import { getAPIKey, setAPIKey, removeAPIKey } from '../hooks/useAI';

interface ProfileModalProps {
  user: User;
  open: boolean;
  onClose: () => void;
  initialTab?: Tab;
  tasks: Task[];
  deadlines: Deadline[];
  projects: Project[];
  aiLearningEnabled: boolean;
  behaviorSummary: string;
  proactivePrompts: string[];
  onAiLearningEnabledChange: (enabled: boolean) => void;
  onOpenPreferenceSetup: () => void;
  onClearBehaviorHistory: () => void;
  onUseBehaviorPrompt: (prompt: string) => void;
  onUserUpdated: () => void;
}

type Tab = 'profile' | 'preferences' | 'data';

// ── Crop helper: canvas → blob ──
async function getCroppedBlob(imageSrc: string, crop: Area): Promise<Blob> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = reject;
    image.src = imageSrc;
  });

  const canvas = document.createElement('canvas');
  const size = 512; // output 512×512
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.drawImage(
    image,
    crop.x, crop.y, crop.width, crop.height,
    0, 0, size, size,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Canvas is empty'))),
      'image/jpeg',
      0.92,
    );
  });
}

export function ProfileModal({
  user,
  open,
  onClose,
  initialTab = 'profile',
  tasks,
  deadlines,
  projects,
  aiLearningEnabled,
  behaviorSummary,
  proactivePrompts,
  onAiLearningEnabledChange,
  onOpenPreferenceSetup,
  onClearBehaviorHistory,
  onUseBehaviorPrompt,
  onUserUpdated,
}: ProfileModalProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiKeyLoading, setGeminiKeyLoading] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  // Profile fields
  const [displayName, setDisplayName] = useState(user.user_metadata?.full_name || '');
  const [avatarUrl, setAvatarUrl] = useState<string>(user.user_metadata?.avatar_url || '');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Crop state
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [cropObj, setCropObj] = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [cropRotation, setCropRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  // Email change
  const [newEmail, setNewEmail] = useState('');

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [learnedOpen, setLearnedOpen] = useState(false);

  const clearMessage = () => setMessage(null);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
  }, [initialTab, open]);

  useEffect(() => {
    if (!open || tab !== 'data') return;
    let cancelled = false;
    setGeminiKeyLoading(true);
    void getAPIKey(user.id).then(key => {
      if (cancelled) return;
      setGeminiKey(key ?? '');
      setGeminiKeyLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, tab, user.id]);

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

  // ── File selected → open crop view ──
  const handleFileSelected = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setCropImage(reader.result as string);
      setCropObj({ x: 0, y: 0 });
      setCropZoom(1);
      setCropRotation(0);
    };
    reader.readAsDataURL(file);
  };

  // ── Confirm crop → upload ──
  const handleCropConfirm = async () => {
    if (!cropImage || !croppedAreaPixels || !supabase) return;
    setUploadingAvatar(true);
    clearMessage();

    try {
      const blob = await getCroppedBlob(cropImage, croppedAreaPixels);
      const path = `${user.id}/avatar.jpg`;

      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });

      if (uploadErr) {
        showMessage('error', 'Could not upload photo. Make sure the "avatars" storage bucket exists.');
        setUploadingAvatar(false);
        return;
      }

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = urlData.publicUrl + '?t=' + Date.now();

      const { error: updateErr } = await supabase.auth.updateUser({
        data: { avatar_url: publicUrl },
      });

      if (updateErr) {
        showMessage('error', updateErr.message);
      } else {
        setAvatarUrl(publicUrl);
        showMessage('success', 'Profile picture updated.');
        onUserUpdated();
      }
    } catch {
      showMessage('error', 'Failed to process image.');
    }

    setUploadingAvatar(false);
    setCropImage(null);
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
    const taskRows = [
      ['Title', 'Status', 'Priority', 'Course', 'Due Date', 'Recurrence', 'Created'].join(','),
      ...tasks.map(t => {
        const course = projects.find(p => p.id === t.projectId);
        return [
          `"${t.title.replace(/"/g, '""')}"`,
          t.status, t.priority,
          `"${course?.name ?? ''}"`,
          t.dueDate ?? '', t.recurrence, t.createdAt,
        ].join(',');
      }),
    ].join('\n');

    const deadlineRows = [
      ['Title', 'Type', 'Status', 'Course', 'Due Date', 'Due Time', 'Notes'].join(','),
      ...deadlines.map(d => {
        const course = projects.find(p => p.id === d.projectId);
        return [
          `"${d.title.replace(/"/g, '""')}"`,
          d.type, d.status,
          `"${course?.name ?? ''}"`,
          d.dueDate, d.dueTime ?? '',
          `"${(d.notes ?? '').replace(/"/g, '""')}"`,
        ].join(',');
      }),
    ].join('\n');

    const courseRows = [
      ['Name', 'Color', 'Created'].join(','),
      ...projects.map(p => [
        `"${p.name.replace(/"/g, '""')}"`,
        p.color, p.createdAt,
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

  const handleSaveGeminiKey = async () => {
    setSaving(true);
    clearMessage();
    await setAPIKey(user.id, geminiKey.trim());
    setSaving(false);
    showMessage('success', 'AI key updated.');
  };

  const handleRemoveGeminiKey = async () => {
    setSaving(true);
    clearMessage();
    await removeAPIKey(user.id);
    setGeminiKey('');
    setSaving(false);
    showMessage('success', 'AI key removed.');
  };

  if (!open) return null;

  const initials = (displayName || user.email?.split('@')[0] || 'U').charAt(0).toUpperCase();
  const memberSince = new Date(user.created_at).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const behaviorLines = behaviorSummary.split('\n').filter(Boolean);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'preferences', label: 'Preferences' },
    { id: 'data', label: 'Data' },
  ];

  // ── Crop overlay ──
  if (cropImage) {
    return createPortal(
      <>
        <div className="fixed inset-0 z-[9998] bg-black/55" />
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div
            className="flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-sm"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Crop Profile Picture</h3>
              <button
                onClick={() => setCropImage(null)}
                className="rounded-xl p-1.5 text-[var(--text-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
              >
                <X size={16} />
              </button>
            </div>

            {/* Crop area */}
            <div className="relative h-72 w-full bg-black/90 sm:h-80">
              <Cropper
                image={cropImage}
                crop={cropObj}
                zoom={cropZoom}
                rotation={cropRotation}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCropObj}
                onZoomChange={setCropZoom}
                onRotationChange={setCropRotation}
                onCropComplete={(_, area) => setCroppedAreaPixels(area)}
              />
            </div>

            {/* Controls */}
            <div className="space-y-3 px-5 py-4">
              {/* Zoom */}
              <div className="flex items-center gap-3">
                <ZoomOut size={14} className="shrink-0 text-[var(--text-faint)]" />
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={cropZoom}
                  onChange={e => setCropZoom(Number(e.target.value))}
                  className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--border-soft)] accent-[var(--accent)] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:shadow-md"
                />
                <ZoomIn size={14} className="shrink-0 text-[var(--text-faint)]" />
              </div>

              {/* Rotate */}
              <div className="flex items-center gap-3">
                <RotateCw size={14} className="shrink-0 text-[var(--text-faint)]" />
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={1}
                  value={cropRotation}
                  onChange={e => setCropRotation(Number(e.target.value))}
                  className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--border-soft)] accent-[var(--accent)] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:shadow-md"
                />
                <span className="w-10 text-right text-xs text-[var(--text-faint)]">{cropRotation}°</span>
              </div>

              {/* Buttons */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setCropImage(null)}
                  className="flex-1 rounded-xl border border-[var(--border-soft)] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCropConfirm}
                  disabled={uploadingAvatar}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium bg-[var(--accent-strong)] text-[var(--accent-contrast)] transition disabled:opacity-50"
                 
                >
                  {uploadingAvatar ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  ) : (
                    <>
                      <Check size={16} />
                      Save
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </>,
      document.body
    );
  }

  // ── Main modal ──
  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998] bg-black/55" onClick={onClose} />
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        <div
          className="w-full max-w-lg overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--surface-elevated)] shadow-sm"
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
                    className="h-16 w-16 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)] text-xl font-bold text-white"
                  >
                    {initials}
                  </div>
                )}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition group-hover:opacity-100"
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
                    if (file) handleFileSelected(file);
                    e.target.value = '';
                  }}
                />
              </div>

              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                  {displayName || user.email?.split('@')[0] || 'User'}
                </h2>
                <p className="text-sm text-[var(--text-muted)]">{user.email}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-faint)]">
                  <Calendar size={12} />
                  Member since {memberSince}
                  <span className="flex items-center gap-1.5">
                    <Fingerprint size={12} />
                    {user.id.slice(0, 8)}...
                  </span>
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
                      className="rounded-xl px-4 py-2.5 text-sm font-medium bg-[var(--accent-strong)] text-[var(--accent-contrast)] transition disabled:opacity-40"
                     
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
                      className="rounded-xl px-4 py-2.5 text-sm font-medium bg-[var(--accent-strong)] text-[var(--accent-contrast)] transition disabled:opacity-40"
                     
                    >
                      Update
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-[var(--text-faint)]">
                    A verification link will be sent to your new email.
                  </p>
                </div>

                <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--text-faint)]">Password</h3>
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
                      className="w-full rounded-xl px-4 py-2.5 text-sm font-medium bg-[var(--accent-strong)] text-[var(--accent-contrast)] transition disabled:opacity-40"
                     
                    >
                      {saving ? 'Updating...' : 'Update Password'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {tab === 'preferences' && (
              <div className="space-y-5">
                <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">AI behavior learning</h3>
                      <p className="mt-1 text-xs text-[var(--text-faint)]">
                        When enabled, new actions count toward learning. When turned off, TaskFlow stays in testing mode and new actions are excluded from learning.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onAiLearningEnabledChange(!aiLearningEnabled)}
                      aria-pressed={aiLearningEnabled}
                      className={cn(
                        'relative h-[24px] w-[42px] shrink-0 rounded-full transition-colors',
                        aiLearningEnabled ? 'bg-emerald-400' : 'bg-[var(--text-faint)]/30'
                      )}
                      title={aiLearningEnabled ? 'Learning is on' : 'Testing mode is on'}
                    >
                      <span
                        className={cn(
                          'absolute top-[2px] left-[2px] h-[20px] w-[20px] rounded-full bg-white shadow-sm transition-transform',
                          aiLearningEnabled ? 'translate-x-[18px]' : 'translate-x-0'
                        )}
                      />
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-4">
                  <button
                    type="button"
                    onClick={() => setLearnedOpen(open => !open)}
                    className="flex w-full items-start justify-between gap-3 text-left"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <Sparkles size={14} className="text-[var(--accent)]" />
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">What TaskFlow has learned</h3>
                      </div>
                      <p className="mt-1 text-xs text-[var(--text-faint)]">
                        {behaviorLines.length > 0
                          ? `View ${behaviorLines.length} learning signals and any proactive suggestions.`
                          : 'No learning signals yet.'}
                      </p>
                    </div>
                    <ChevronDown
                      size={16}
                      className={cn(
                        'mt-0.5 shrink-0 text-[var(--text-faint)] transition-transform',
                        learnedOpen && 'rotate-180',
                      )}
                    />
                  </button>

                  {learnedOpen && (
                    <div className="mt-4 space-y-2">
                      {behaviorLines.map(line => (
                        <div
                          key={line}
                          className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text-secondary)]"
                        >
                          {line}
                        </div>
                      ))}
                      {proactivePrompts.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {proactivePrompts.map(prompt => (
                            <button
                              key={prompt}
                              onClick={() => {
                                onUseBehaviorPrompt(prompt);
                                onClose();
                              }}
                              className="rounded-full border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--accent)] transition hover:border-[var(--accent)]/45"
                            >
                              {prompt}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Sparkles size={14} className="text-[var(--accent)]" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Customize your preferences</h3>
                  </div>
                  <p className="mb-3 text-xs text-[var(--text-faint)]">
                    Reopen the onboarding-style setup if you want to adjust how AI plans, paces, and schedules for you.
                  </p>
                  <button
                    onClick={onOpenPreferenceSetup}
                    className="flex w-full items-center justify-between rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 text-left transition hover:border-[var(--accent)]/40"
                  >
                    <div>
                      <div className="text-sm font-medium text-[var(--text-primary)]">Customize your preferences</div>
                      <div className="text-xs text-[var(--text-faint)]">
                        Re-answer the planning questions and update how AI personalizes your schedule.
                      </div>
                    </div>
                    <span className="text-xs font-medium text-[var(--accent)]">Open</span>
                  </button>
                </div>

                <div className="rounded-xl border border-rose-500/15 bg-rose-500/5 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Trash2 size={14} className="text-rose-400" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Reset learned behavior</h3>
                  </div>
                  <p className="mb-3 text-xs text-[var(--text-faint)]">
                    Clear behavior-learning history if you were testing a lot and want a clean slate.
                  </p>
                  <button
                    onClick={() => {
                      onClearBehaviorHistory();
                      showMessage('success', 'Behavior learning history cleared.');
                    }}
                    className="rounded-xl border border-rose-500/20 px-4 py-2.5 text-sm font-medium text-rose-400 transition hover:bg-rose-500/10"
                  >
                    Clear learned behavior
                  </button>
                </div>
              </div>
            )}

            {tab === 'data' && (
              <div className="space-y-5">
                <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-muted)] p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Sparkles size={14} className="text-[var(--accent)]" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">AI Key</h3>
                  </div>
                  <p className="mb-3 text-sm text-[var(--text-muted)]">
                    Keep your Gemini key here so the AI assistant can work without taking up panel space.
                  </p>
                  <div className="space-y-3">
                    <div className="relative">
                      <input
                        type={showGeminiKey ? 'text' : 'password'}
                        value={geminiKey}
                        onChange={e => setGeminiKey(e.target.value)}
                        placeholder={geminiKeyLoading ? 'Loading key...' : 'Paste your Gemini API key'}
                        disabled={geminiKeyLoading}
                        className="w-full rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 pr-11 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={() => setShowGeminiKey(prev => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-[var(--text-faint)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
                      >
                        {showGeminiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveGeminiKey}
                        disabled={saving || !geminiKey.trim()}
                        className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium bg-[var(--accent-strong)] text-[var(--accent-contrast)] transition disabled:opacity-50"
                       
                      >
                        Save key
                      </button>
                      <button
                        onClick={handleRemoveGeminiKey}
                        disabled={saving || !geminiKey.trim()}
                        className="rounded-xl border border-rose-500/20 px-4 py-2.5 text-sm font-medium text-rose-400 transition hover:bg-rose-500/10 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                    <p className="text-[11px] text-[var(--text-faint)]">
                      Your key is stored in your account settings and cached locally for faster AI responses.
                    </p>
                  </div>
                </div>

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
