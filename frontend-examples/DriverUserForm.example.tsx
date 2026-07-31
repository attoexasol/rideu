/**
 * User Management modal — driver cab field integration example.
 *
 * Copy CabIdentifierField + cabIdentifierApi into your DriveWize frontend.
 */

import { useState } from 'react';
import { CabIdentifierField, type CabIdentifierValue } from './CabIdentifierField';
import {
  cabIdentifierFromDriver,
  createDriverUser,
  updateDriver,
} from './cabIdentifierApi';

interface DriverUserFormProps {
  token: string;
  mode: 'create' | 'edit';
  driverId?: string;
  initialDriver?: {
    email: string;
    name: string;
    phone?: string;
    cabName?: string;
    cabNumber?: string | null;
    cabLicence?: string | null;
  };
  onSuccess: () => void;
  onCancel: () => void;
}

export function DriverUserForm({
  token,
  mode,
  driverId,
  initialDriver,
  onSuccess,
  onCancel,
}: DriverUserFormProps) {
  const [name, setName] = useState(initialDriver?.name ?? '');
  const [email, setEmail] = useState(initialDriver?.email ?? '');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState(initialDriver?.phone ?? '');
  const [cabName, setCabName] = useState(initialDriver?.cabName ?? '');
  const [cab, setCab] = useState<CabIdentifierValue>(
    initialDriver ? cabIdentifierFromDriver(initialDriver) : { cabFieldType: 'cab_number', cabValue: '' }
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setLoading(true);

    try {
      if (mode === 'create') {
        await createDriverUser(token, {
          email,
          password,
          name,
          role: 'driver',
          phone: phone || undefined,
          cabName: cabName || undefined,
          cab,
        });
      } else if (driverId) {
        await updateDriver(token, driverId, {
          name,
          phone: phone || null,
          cabName: cabName || null,
          cab,
        });
      }

      onSuccess();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* ...other User Management fields... */}

      <label>
        Cab Name
        <input value={cabName} onChange={(e) => setCabName(e.target.value)} />
      </label>

      <CabIdentifierField value={cab} onChange={setCab} disabled={loading} error={submitError ?? undefined} />

      {submitError ? <p role="alert">{submitError}</p> : null}

      <button type="submit" disabled={loading}>
        {mode === 'create' ? 'Create User' : 'Save Changes'}
      </button>
      <button type="button" onClick={onCancel} disabled={loading}>
        Cancel
      </button>
    </form>
  );
}
