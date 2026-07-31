import { useId, useState } from 'react';

export type CabFieldType = 'cab_number' | 'cab_licence';

export interface CabIdentifierValue {
  cabFieldType: CabFieldType;
  cabValue: string;
}

interface CabIdentifierFieldProps {
  value: CabIdentifierValue;
  onChange: (value: CabIdentifierValue) => void;
  disabled?: boolean;
  error?: string;
}

/**
 * Radio + single input for cab number OR cab licence.
 * Wire into User Management create/edit forms for drivers.
 */
export function CabIdentifierField({
  value,
  onChange,
  disabled = false,
  error,
}: CabIdentifierFieldProps) {
  const groupId = useId();
  const [localError, setLocalError] = useState<string | undefined>();

  const validate = (fieldType: CabFieldType, input: string): string | undefined => {
    const trimmed = input.trim();
    if (!trimmed) {
      return 'Cab number or licence is required';
    }
    if (trimmed.length > 100) {
      return 'Must be 100 characters or less';
    }
    return undefined;
  };

  const handleFieldTypeChange = (fieldType: CabFieldType) => {
    setLocalError(undefined);
    onChange({ ...value, cabFieldType: fieldType });
  };

  const handleValueChange = (input: string) => {
    setLocalError(undefined);
    onChange({ ...value, cabValue: input });
  };

  const handleBlur = () => {
    setLocalError(validate(value.cabFieldType, value.cabValue));
  };

  const displayError = error || localError;
  const placeholder =
    value.cabFieldType === 'cab_number' ? 'e.g., 123, CAB-001' : 'e.g., LIC-5678';

  return (
    <div className="cab-identifier-field">
      <div role="radiogroup" aria-labelledby={`${groupId}-label`} className="cab-identifier-radios">
        <span id={`${groupId}-label`} className="cab-identifier-label">
          Cab identifier
        </span>

        <label>
          <input
            type="radio"
            name={`${groupId}-cab-field`}
            value="cab_number"
            checked={value.cabFieldType === 'cab_number'}
            onChange={() => handleFieldTypeChange('cab_number')}
            disabled={disabled}
          />
          Cab Number
        </label>

        <label>
          <input
            type="radio"
            name={`${groupId}-cab-field`}
            value="cab_licence"
            checked={value.cabFieldType === 'cab_licence'}
            onChange={() => handleFieldTypeChange('cab_licence')}
            disabled={disabled}
          />
          Cab Licence
        </label>
      </div>

      <input
        type="text"
        value={value.cabValue}
        onChange={(e) => handleValueChange(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        maxLength={100}
        disabled={disabled}
        aria-invalid={Boolean(displayError)}
        aria-describedby={displayError ? `${groupId}-error` : undefined}
      />

      {displayError ? (
        <p id={`${groupId}-error`} role="alert" className="cab-identifier-error">
          {displayError}
        </p>
      ) : null}
    </div>
  );
}
