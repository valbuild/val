import pc from "picocolors";
import { ciReportFromEnv, reportCiRun } from "./publish/reportCiRun";

/**
 * `val ci-report` -- a thin shell around `reportCiRun`. It never fails the
 * job: the build's own result is what the job's status is, and a report that
 * could not be sent is said and then left.
 */
export async function ciReport(options: {
  root?: string;
  status?: string;
  commit?: string;
  branch?: string;
  url?: string;
}): Promise<void> {
  const read = ciReportFromEnv({
    status: options.status,
    ...(options.commit ? { commit: options.commit } : {}),
    ...(options.branch ? { branch: options.branch } : {}),
    ...(options.url ? { url: options.url } : {}),
  });
  if (read.status === "error") {
    console.error(pc.yellow(`val ci-report: ${read.message}`));
    return;
  }
  const sent = await reportCiRun({
    root: options.root ?? process.cwd(),
    report: read.report,
  });
  if (sent.status === "error") {
    console.error(pc.yellow(`val ci-report: not reported. ${sent.message}`));
    return;
  }
  console.log(
    pc.dim(
      `Reported the build of ${read.report.commit.slice(0, 7)} as ${read.report.status}.`,
    ),
  );
}
