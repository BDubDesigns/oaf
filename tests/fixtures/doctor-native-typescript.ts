import { checkApp, type DoctorCheck, type DoctorCheckLabel } from "../../lib/doctor.ts";

const checks: DoctorCheck[] = checkApp();
const undefinedChecks: DoctorCheck[] = checkApp(undefined);
const pathChecks: DoctorCheck[] = checkApp("path");
const labels: DoctorCheckLabel[] = [
  "oaf/app.json",
  "oaf/stack.json",
  "oaf/docs-pack.json",
  "README.md",
  "package.json",
  "app/",
  "components/",
  "features/",
  "lib/",
  "server/",
  "db/",
  "tests/",
  "e2e/",
  "public/",
  "docs/",
  "oaf/",
];

const check: DoctorCheck = { ok: true, label: labels[0] };
const ok: boolean = check.ok;
const label: DoctorCheckLabel = check.label;
checks.push(check);
check.ok = false;
check.label = "app/";

if (false) {
  // @ts-expect-error numeric directories are rejected.
  checkApp(1);
  // @ts-expect-error nullable directories are rejected.
  checkApp(null);
  // @ts-expect-error options objects are rejected.
  checkApp({ dir: "path" });
  // @ts-expect-error filesystem injection is rejected.
  checkApp("path", { existsSync() { return true; } });
  // @ts-expect-error arbitrary second arguments are rejected.
  checkApp("path", "extra");
  // @ts-expect-error unknown labels are rejected.
  const unknownLabel: DoctorCheckLabel = "unknown/";
  // @ts-expect-error checks require ok.
  const missingOk: DoctorCheck = { label: "app/" };
  // @ts-expect-error checks require label.
  const missingLabel: DoctorCheck = { ok: true };
  // @ts-expect-error check object literals reject extra fields.
  const extraField: DoctorCheck = { ok: true, label: "app/", path: "app" };
  // @ts-expect-error ok cannot be a string.
  const stringOk: DoctorCheck = { ok: "true", label: "app/" };
  // @ts-expect-error labels cannot be arbitrary strings.
  const arbitraryLabel: DoctorCheck = { ok: true, label: "anything" };

  void unknownLabel;
  void missingOk;
  void missingLabel;
  void extraField;
  void stringOk;
  void arbitraryLabel;
}

void undefinedChecks;
void pathChecks;
void ok;
void label;
console.log("doctor-native-typescript:ok");
