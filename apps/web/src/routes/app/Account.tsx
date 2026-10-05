import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  Bell,
  CircleCheck,
  Download,
  KeyRound,
  Laptop,
  Lock,
  Mail,
  MessageSquareWarning,
  Phone,
  ShieldAlert,
  Trash2,
  Upload,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  COUNTRIES,
  type KycDTO,
  KYC_ID_TYPES,
  type LoginEventDTO,
  type MeDTO,
  type NotificationDTO,
  type SessionDTO,
  type TicketDTO,
  type UserPrefs,
  formatUsd,
  parseDollarInput,
} from '@lucrum/shared';
import { PhoneVerifyModal } from '../../components/verify';
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  CopyButton,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Segmented,
  Select,
  Skeleton,
  Switch,
  Textarea,
} from '../../components/ui';
import { api, del, errorMessage, get, patch, post } from '../../lib/api';
import { qk, useConfig, useMe, useWallet } from '../../lib/queries';
import { browserTimezone } from '../../lib/device';
import { cn, dateTime, downloadUrl, timeAgo } from '../../lib/utils';
import { toast, useUI } from '../../store/ui';

type Tab = 'profile' | 'preferences' | 'security' | 'verification' | 'privacy';

export function Profile() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'profile';
  const { data: me } = useMe();
  if (!me) return <Skeleton className="h-96" />;
  return (
    <div>
      <PageHeader title="Profile & settings" subtitle={me.email} />
      <Segmented<Tab>
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        options={[
          { value: 'profile', label: 'Profile' },
          { value: 'preferences', label: 'Preferences' },
          { value: 'security', label: 'Security' },
          { value: 'verification', label: 'Verification' },
          { value: 'privacy', label: 'Privacy' },
        ]}
        className="mb-5 max-w-full overflow-x-auto"
      />
      {tab === 'profile' && <ProfileTab me={me} />}
      {tab === 'preferences' && <PreferencesTab me={me} />}
      {tab === 'security' && <SecurityTab me={me} />}
      {tab === 'verification' && <VerificationTab me={me} />}
      {tab === 'privacy' && <PrivacyTab />}
    </div>
  );
}

function useSaveMe() {
  const qc = useQueryClient();
  return (r: { user: MeDTO }) => {
    qc.setQueryData(qk.me, r.user);
    qc.invalidateQueries({ queryKey: qk.wallet });
  };
}

function ProfileTab({ me }: { me: MeDTO }) {
  const save = useSaveMe();
  const { data: config } = useConfig();
  const [form, setForm] = useState({
    displayName: me.displayName ?? '',
    fullName: me.fullName ?? '',
    country: me.country,
    timezone: me.timezone,
    displayCurrency: me.displayCurrency,
  });
  const [goal, setGoal] = useState({
    amount: me.prefs.savingsGoalMicros ? (me.prefs.savingsGoalMicros / 1e6).toFixed(2) : '',
    label: me.prefs.savingsGoalLabel ?? '',
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () =>
      patch<{ user: MeDTO }>('/me/profile', {
        ...form,
        displayName: form.displayName || null,
        fullName: form.fullName || null,
      }),
    onSuccess: (r) => {
      save(r);
      setFields({});
      toast.success('Profile saved');
    },
    onError: (err) => toast.error('Couldn’t save', errorMessage(err)),
  });
  const g = useMutation({
    mutationFn: () =>
      patch<{ user: MeDTO }>('/me/prefs', {
        savingsGoalMicros: parseDollarInput(goal.amount),
        savingsGoalLabel: goal.label || null,
      }),
    onSuccess: (r) => {
      save(r);
      toast.success('Goal saved', 'Track it on your dashboard.');
    },
  });
  return (
    <div className="space-y-5">
      <Card className="space-y-4">
        <CardHeader
          title="Public profile"
          subtitle="Only shown if you opt in to the leaderboard or payout wall."
        />
        <Input
          label="Display name"
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          error={fields.displayName}
          placeholder="e.g. Ada O."
        />
        <Input
          label="Full name (optional)"
          value={form.fullName}
          onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          hint="Only needed for bank payouts and ID checks."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Country"
            value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })}
            hint="Locked after your first cash-out (support can change it)."
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name}
              </option>
            ))}
          </Select>
          <Select
            label="Show amounts also in"
            value={form.displayCurrency}
            onChange={(e) => setForm({ ...form, displayCurrency: e.target.value })}
          >
            {Object.keys(config?.fxRates ?? { USD: 1 }).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <Input
              label="Timezone (streaks reset at your midnight)"
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            />
          </div>
          <Button
            variant="secondary"
            className="h-11"
            onClick={() => setForm({ ...form, timezone: browserTimezone() })}
          >
            Use this device’s
          </Button>
        </div>
        <Button loading={m.isPending} onClick={() => m.mutate()}>
          Save profile
        </Button>
      </Card>
      <Card className="space-y-4">
        <CardHeader
          title="Savings goal"
          subtitle="Give your earnings a purpose — we’ll show your progress on the dashboard."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Goal amount"
            prefix="$"
            value={goal.amount}
            onChange={(e) => setGoal({ ...goal, amount: e.target.value })}
            placeholder="10.00"
          />
          <Input
            label="What’s it for?"
            value={goal.label}
            onChange={(e) => setGoal({ ...goal, label: e.target.value })}
            placeholder="New phone fund"
          />
        </div>
        <Button variant="secondary" loading={g.isPending} onClick={() => g.mutate()}>
          Save goal
        </Button>
      </Card>
    </div>
  );
}

function PreferencesTab({ me }: { me: MeDTO }) {
  const save = useSaveMe();
  const setTheme = useUI((s) => s.setTheme);
  const theme = useUI((s) => s.theme);
  const update = useMutation({
    mutationFn: (p: Partial<UserPrefs>) => patch<{ user: MeDTO }>('/me/prefs', p),
    onSuccess: save,
    onError: (err) => toast.error('Couldn’t save', errorMessage(err)),
  });
  const p = me.prefs;
  const email = (k: keyof UserPrefs['notifyEmail'], label: string, description?: string) => (
    <Switch
      checked={p.notifyEmail[k]}
      onChange={(v) => update.mutate({ notifyEmail: { ...p.notifyEmail, [k]: v } })}
      label={label}
      description={description}
    />
  );
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Display" />
        <div className="flex items-center justify-between py-3">
          <p className="text-sm font-medium">Theme</p>
          <Segmented
            value={theme}
            onChange={(t) => {
              setTheme(t);
              update.mutate({ theme: t });
            }}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
        <Switch
          checked={p.dataSaver}
          onChange={(v) => update.mutate({ dataSaver: v })}
          label="Data-saver mode"
          description="Hides heavy tasks, prefers text-only content and skips animations — for slow or expensive connections."
        />
        <Switch
          checked={p.reduceMotion}
          onChange={(v) => update.mutate({ reduceMotion: v })}
          label="Reduce motion"
          description="No confetti or count-up animations."
        />
      </Card>
      <Card>
        <CardHeader title="Privacy" subtitle="Privacy-first defaults: you’re anonymous unless you opt in." />
        <Switch
          checked={p.leaderboardOptIn}
          onChange={(v) => update.mutate({ leaderboardOptIn: v })}
          label="Show my display name on the leaderboard"
        />
        <Switch
          checked={p.showOnPayoutWall}
          onChange={(v) => update.mutate({ showOnPayoutWall: v })}
          label="Show my display name in the public payout feed"
          description={
            me.displayName
              ? 'Helps new members trust that payouts are real.'
              : 'Set a display name on the Profile tab first.'
          }
          disabled={!me.displayName}
        />
        <Switch
          checked={p.privacyMode}
          onChange={(v) => update.mutate({ privacyMode: v })}
          label="Privacy mode"
          description="No optional analytics. Fraud-prevention signals (device, IP) are still required to protect payouts."
        />
      </Card>
      <Card>
        <CardHeader
          title="Email notifications"
          subtitle="In-app notifications are always on. Choose what also reaches your inbox."
          icon={<Bell className="size-5 text-slate-400" />}
        />
        {email('payouts', 'Cash-out updates', 'Sent, delayed, failed')}
        {email('claims', 'Missing-credit claims', 'Approved, rejected, under review')}
        {email('security', 'Security alerts', 'New sign-ins, password and 2FA changes (recommended)')}
        {email('streaks', 'Streak reminders', 'One gentle reminder in the evening, never more')}
        {email('offers', 'New high-paying offers')}
      </Card>
    </div>
  );
}

function SecurityTab({ me }: { me: MeDTO }) {
  const qc = useQueryClient();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [disableCode, setDisableCode] = useState('');
  const { data: sessions } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => get<SessionDTO[]>('/auth/sessions'),
  });
  const { data: history } = useQuery({
    queryKey: ['login-history'],
    queryFn: () => get<LoginEventDTO[]>('/auth/login-history'),
  });
  const changePw = useMutation({
    mutationFn: () => post('/auth/change-password', pw),
    onSuccess: () => {
      setPw({ currentPassword: '', newPassword: '' });
      toast.success('Password changed', 'Other devices were signed out.');
      qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err) => toast.error('Couldn’t change password', errorMessage(err)),
  });
  const startSetup = useMutation({
    mutationFn: () => post<{ secret: string; qrSvg: string }>('/auth/2fa/setup'),
    onSuccess: setSetup,
    onError: (e) => toast.error('Error', errorMessage(e)),
  });
  const enable = useMutation({
    mutationFn: () => post<{ recoveryCodes: string[] }>('/auth/2fa/enable', { code }),
    onSuccess: (r) => {
      setRecovery(r.recoveryCodes);
      setSetup(null);
      qc.invalidateQueries({ queryKey: qk.me });
    },
    onError: (e) => toast.error('That code didn’t work', errorMessage(e)),
  });
  const disable = useMutation({
    mutationFn: () => post('/auth/2fa/disable', { code: disableCode }),
    onSuccess: () => {
      setDisableCode('');
      qc.invalidateQueries({ queryKey: qk.me });
      toast.info('Two-factor authentication turned off');
    },
    onError: (e) => toast.error('That code didn’t work', errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => del(`/auth/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
  const revokeOthers = useMutation({
    mutationFn: () => post('/auth/sessions/revoke-others'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Two-factor authentication"
          subtitle="Protects sign-ins and cash-outs with a code from an authenticator app."
          icon={<KeyRound className="size-5 text-brand-600" />}
          action={me.totpEnabled ? <Badge tone="success">On</Badge> : <Badge tone="warning">Off</Badge>}
        />
        {recovery && (
          <Callout tone="success" title="2FA is on — save your recovery codes">
            Each code works once if you lose your phone. Store them somewhere safe.
            <div className="mt-3 grid grid-cols-2 gap-1.5 font-mono text-sm">
              {recovery.map((c) => (
                <span key={c} className="rounded bg-white/70 px-2 py-1 dark:bg-black/20">
                  {c}
                </span>
              ))}
            </div>
            <div className="mt-3">
              <CopyButton value={recovery.join('\n')} label="Copy codes" />
            </div>
          </Callout>
        )}
        {!me.totpEnabled && !setup && !recovery && (
          <Button onClick={() => startSetup.mutate()} loading={startSetup.isPending}>
            Set up authenticator app
          </Button>
        )}
        {setup && (
          <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
            <div
              className="size-44 rounded-2xl border border-slate-200 bg-white p-2"
              dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
            />
            <div className="space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Scan with Google Authenticator, Authy or 1Password, or enter this key:
              </p>
              <p className="break-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm dark:bg-slate-800">
                {setup.secret}
              </p>
              <Input
                label="6-digit code"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
              />
              <Button onClick={() => enable.mutate()} loading={enable.isPending} disabled={code.length !== 6}>
                Turn on 2FA
              </Button>
            </div>
          </div>
        )}
        {me.totpEnabled && !recovery && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1">
              <Input
                label="Code (or recovery code) to turn off"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              className="h-11"
              onClick={() => disable.mutate()}
              loading={disable.isPending}
              disabled={disableCode.length < 6}
            >
              Turn off
            </Button>
          </div>
        )}
      </Card>
      <Card className="space-y-4">
        <CardHeader title="Password" icon={<Lock className="size-5 text-slate-400" />} />
        <Input
          label="Current password"
          type="password"
          value={pw.currentPassword}
          onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
          autoComplete="current-password"
        />
        <Input
          label="New password"
          type="password"
          value={pw.newPassword}
          onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
          autoComplete="new-password"
          hint="10+ characters with letters and a number."
        />
        <Button variant="secondary" onClick={() => changePw.mutate()} loading={changePw.isPending}>
          Change password
        </Button>
      </Card>
      <Card>
        <CardHeader
          title="Signed-in devices"
          subtitle="Sign out anything you don’t recognise."
          action={
            <Button size="sm" variant="outline" onClick={() => revokeOthers.mutate()}>
              Sign out others
            </Button>
          }
        />
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {sessions?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3 text-sm">
              <Laptop className="size-5 text-slate-400" />
              <div className="flex-1">
                <p className="font-medium">
                  {s.label} {s.current && <Badge tone="brand">This device</Badge>}
                </p>
                <p className="text-xs text-slate-500">
                  {s.ip} · active {timeAgo(s.lastUsedAt)}
                </p>
              </div>
              {!s.current && (
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Recent sign-ins" />
        <ul className="space-y-2 text-sm">
          {history?.slice(0, 10).map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3">
              <span className={cn(h.success ? 'text-slate-700 dark:text-slate-300' : 'text-rose-600')}>
                {h.success ? '✓' : '✗'} {h.label}
                {!h.success && ' — failed attempt'}
              </span>
              <span className="text-xs text-slate-500">
                {h.ip} · {dateTime(h.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function VerificationTab({ me }: { me: MeDTO }) {
  const [phoneOpen, setPhoneOpen] = useState(false);
  const row = (icon: ReactNode, title: string, body: string, done: boolean, action: ReactNode) => (
    <div className="flex items-start gap-4 py-4">
      <span className="mt-0.5">{icon}</span>
      <div className="flex-1">
        <p className="flex items-center gap-2 font-medium">
          {title} {done ? <Badge tone="success">Verified</Badge> : <Badge>Not yet</Badge>}
        </p>
        <p className="mt-0.5 text-sm text-slate-500">{body}</p>
      </div>
      {!done && action}
    </div>
  );
  return (
    <Card>
      <CardHeader title="Verification" subtitle="We only ask when it matters — never at sign-up." />
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {row(
          <Mail className="size-5 text-slate-400" />,
          'Email',
          'Required before any cash-out.',
          me.emailVerified,
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              post('/auth/resend-verification')
                .then(() => toast.success('Email sent', 'Sandbox: check the Dev inbox.'))
                .catch((e) => toast.error('Error', errorMessage(e)))
            }
          >
            Resend
          </Button>,
        )}
        {row(
          <Phone className="size-5 text-slate-400" />,
          `Phone${me.phoneLast4 ? ` ••${me.phoneLast4}` : ''}`,
          'Required for cash-outs above $1. One number per account.',
          me.phoneVerified,
          <Button size="sm" variant="outline" onClick={() => setPhoneOpen(true)}>
            Verify
          </Button>,
        )}
        {row(
          <BadgeCheck className="size-5 text-slate-400" />,
          'Identity',
          'Required for a single cash-out above $100, and for Platinum tier.',
          me.kycStatus === 'verified',
          <ButtonLink size="sm" variant="outline" to="/app/kyc">
            {me.kycStatus === 'pending' ? 'In review' : 'Start'}
          </ButtonLink>,
        )}
      </div>
      <PhoneVerifyModal open={phoneOpen} onClose={() => setPhoneOpen(false)} />
    </Card>
  );
}

function PrivacyTab() {
  const { data: wallet } = useWallet();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const remove = useMutation({
    mutationFn: () => post('/me/delete', { password, confirm }),
    onSuccess: () => {
      qc.clear();
      navigate('/');
    },
  });
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Your data"
          subtitle="Everything we hold about you, in one JSON file (NDPA / GDPR)."
        />
        <Button variant="outline" onClick={() => downloadUrl('/me/export')}>
          <Download className="size-4" /> Download my data
        </Button>
        <p className="mt-3 text-sm text-slate-500">
          Read the{' '}
          <Link to="/legal/privacy" className="underline">
            privacy policy
          </Link>{' '}
          for what we collect and why.
        </p>
      </Card>
      <Card className="border-rose-200 dark:border-rose-900/60">
        <CardHeader
          title="Delete account"
          subtitle="Erases your personal data. Financial records are kept anonymised for legal reasons."
          icon={<Trash2 className="size-5 text-rose-500" />}
        />
        {wallet && wallet.availableMicros >= 10_000 && (
          <Callout
            tone="warning"
            className="mb-4"
            title={`You still have ${formatUsd(wallet.availableMicros, { floor: true })}`}
          >
            Cash it out or donate it first — deleting your account forfeits any remaining balance.
          </Callout>
        )}
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete my account
        </Button>
      </Card>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete your account?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              disabled={confirm !== 'DELETE' || !password}
              onClick={() => remove.mutate()}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {remove.isError && <Callout tone="danger">{errorMessage(remove.error)}</Callout>}
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Input
            label='Type "DELETE" to confirm'
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}

export function Kyc() {
  const qc = useQueryClient();
  const { data: kyc, isLoading } = useQuery({
    queryKey: ['kyc'],
    queryFn: () => get<KycDTO>('/kyc'),
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 3000 : false),
  });
  const { data: config } = useConfig();
  const [form, setForm] = useState({ idType: 'nin', idNumber: '', fullName: '', dateOfBirth: '' });
  const [doc, setDoc] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const submit = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (doc) fd.append('document', doc);
      if (selfie) fd.append('selfie', selfie);
      return api<KycDTO>('/kyc', { method: 'POST', body: fd });
    },
    onSuccess: (r) => {
      qc.setQueryData(['kyc'], r);
      qc.invalidateQueries({ queryKey: qk.me });
    },
    onError: (err) => {
      const e = err as { fields?: Record<string, string> };
      if (e.fields) setFields(e.fields);
    },
  });
  if (isLoading || !kyc) return <Skeleton className="h-96" />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Identity verification"
        subtitle="Only needed for a single cash-out above $100 or Platinum tier."
        back={{ to: '/app/profile?tab=verification', label: 'Verification' }}
      />
      {kyc.status === 'verified' && (
        <Callout tone="success" title="You’re verified">
          {kyc.idType?.toUpperCase()} {kyc.idNumberMasked} · verified {timeAgo(kyc.reviewedAt)}
        </Callout>
      )}
      {kyc.status === 'pending' && (
        <Callout tone="info" title="In review">
          Submitted {timeAgo(kyc.submittedAt)}. Most checks finish within minutes; we’ll notify you.
        </Callout>
      )}
      {(kyc.status === 'none' || kyc.status === 'rejected') && (
        <Card className="space-y-4">
          {kyc.status === 'rejected' && (
            <Callout tone="danger" title="We need another look">
              {kyc.reviewerNote}
            </Callout>
          )}
          {config?.sandbox && (
            <Callout tone="info">
              Sandbox: ID numbers containing “0000” are rejected; everything else is verified automatically in
              a few seconds.
            </Callout>
          )}
          {submit.isError && <Callout tone="danger">{errorMessage(submit.error)}</Callout>}
          <Select
            label="ID type"
            value={form.idType}
            onChange={(e) => setForm({ ...form, idType: e.target.value })}
          >
            {KYC_ID_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === 'nin' ? 'NIN (National Identity Number)' : t.replaceAll('_', ' ')}
              </option>
            ))}
          </Select>
          <Input
            label="ID number"
            value={form.idNumber}
            onChange={(e) => setForm({ ...form, idNumber: e.target.value })}
            error={fields.idNumber}
          />
          <Input
            label="Full name (as on the ID)"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            error={fields.fullName}
          />
          <Input
            label="Date of birth"
            type="date"
            value={form.dateOfBirth}
            onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
            error={fields.dateOfBirth}
          />
          <FilePick label="Photo of your ID" file={doc} onFile={setDoc} error={fields.document} />
          <FilePick label="Selfie (optional, speeds up review)" file={selfie} onFile={setSelfie} />
          <Button block size="lg" loading={submit.isPending} onClick={() => submit.mutate()}>
            Submit for verification
          </Button>
          <p className="text-xs text-slate-500">
            Documents are stored privately, encrypted, visible only to our verification team, and never shared
            with advertisers.
          </p>
        </Card>
      )}
    </div>
  );
}

function FilePick({
  label,
  file,
  onFile,
  error,
}: {
  label: string;
  file: File | null;
  onFile: (f: File | null) => void;
  error?: string;
}) {
  return (
    <div>
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-400">
        <Upload className="size-5" />
        <span className="flex-1">{file ? file.name : label}</span>
        {file && <CircleCheck className="size-4 text-emerald-500" />}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {error && <p className="mt-1 text-sm text-rose-600">{error}</p>}
    </div>
  );
}

export function Notifications() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: qk.notifications,
    queryFn: () => get<{ unread: number; items: NotificationDTO[] }>('/notifications?limit=50'),
  });
  const markAll = useMutation({
    mutationFn: () => post('/notifications/read', { all: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.notifications }),
  });
  const open = async (n: NotificationDTO) => {
    if (!n.readAt) await post('/notifications/read', { ids: [n.id] }).catch(() => undefined);
    qc.invalidateQueries({ queryKey: qk.notifications });
    if (n.link) navigate(n.link);
  };
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Notifications"
        actions={
          data?.unread ? (
            <Button variant="outline" size="sm" onClick={() => markAll.mutate()}>
              Mark all read
            </Button>
          ) : undefined
        }
      />
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !data?.items.length ? (
        <EmptyState icon="🔔" title="You’re all caught up" />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.items.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => open(n)}
                  className={cn(
                    'flex w-full gap-3 px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40',
                    !n.readAt && 'bg-brand-50/40 dark:bg-brand-950/20',
                  )}
                >
                  <span
                    className={cn(
                      'mt-1.5 size-2 shrink-0 rounded-full',
                      n.readAt ? 'bg-transparent' : 'bg-brand-500',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{n.title}</p>
                    <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{n.body}</p>
                    <p className="mt-1 text-xs text-slate-400">{timeAgo(n.createdAt)}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function Restricted() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [message, setMessage] = useState('');
  const appeal = useMutation({
    mutationFn: () => post<TicketDTO>('/support/appeal', { message }),
    onSuccess: () => {
      setMessage('');
      qc.invalidateQueries({ queryKey: qk.me });
      toast.success('Appeal sent', 'A person who wasn’t involved in the original decision will review it.');
    },
  });
  if (!me) return <Skeleton className="h-96" />;
  const r = me.restriction;
  if (!r)
    return (
      <EmptyState
        icon="✅"
        title="Your account is in good standing"
        action={<ButtonLink to="/app">Dashboard</ButtonLink>}
      />
    );
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title="Account status"
        subtitle="We always tell you exactly why — never just “terms violation”."
      />
      <Card className="border-rose-200 p-6 dark:border-rose-900/60">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
            <ShieldAlert className="size-6" />
          </span>
          <div>
            <h2 className="text-lg font-semibold">{r.title}</h2>
            <p className="mt-1 text-slate-600 dark:text-slate-400">{r.explanation}</p>
            {r.message && (
              <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800/50">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">From our team</p>
                <p className="mt-1">{r.message}</p>
              </div>
            )}
            <p className="mt-3 text-xs text-slate-500">
              {r.at && <>Since {dateTime(r.at)} · </>}
              {r.balanceFrozen
                ? 'Your balance is frozen (not taken) while this is resolved.'
                : 'Your balance is safe.'}
            </p>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader
          title="Appeal"
          subtitle="Tell us what we got wrong. Every appeal is read by a person, usually within 72 hours."
          icon={<MessageSquareWarning className="size-5 text-slate-400" />}
        />
        {r.appeal && (
          <Callout
            tone="info"
            className="mb-4"
            title={`Appeal ${r.appeal.status.replace('_', ' ')}`}
            action={
              <ButtonLink size="sm" variant="outline" to={`/app/support/${r.appeal.ticketId}`}>
                Open thread
              </ButtonLink>
            }
          >
            Last update {timeAgo(r.appeal.updatedAt)}.
          </Callout>
        )}
        {appeal.isError && (
          <Callout tone="danger" className="mb-3">
            {errorMessage(appeal.error)}
          </Callout>
        )}
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          placeholder="Explain your situation. Proof (e.g. that a shared device belongs to family members) helps."
        />
        <Button
          className="mt-3"
          loading={appeal.isPending}
          disabled={message.trim().length < 20}
          onClick={() => appeal.mutate()}
        >
          {r.appeal ? 'Add to my appeal' : 'Submit appeal'}
        </Button>
      </Card>
    </div>
  );
}
