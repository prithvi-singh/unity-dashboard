/**
 * Build a deep link into Unity for a patient record.
 * Set NEXT_PUBLIC_UNITY_PATIENT_URL in .env.local, e.g.:
 *   NEXT_PUBLIC_UNITY_PATIENT_URL=https://unity.momsbelief.com/patient/{patientId}
 */
export function unityPatientUrl(patientId: number): string | null {
  const template = process.env.NEXT_PUBLIC_UNITY_PATIENT_URL;
  if (!template) return null;
  return template
    .replace(/\{patientId\}/g, String(patientId))
    .replace(/\{id\}/g, String(patientId));
}

export function hasUnityPatientLinks(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_UNITY_PATIENT_URL);
}
