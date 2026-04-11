function formatIssue(issue) {
    const location = issue.path ? ` (${issue.path})` : '';
    const details = issue.details ? ` details=${JSON.stringify(issue.details)}` : '';
    return `[${issue.code}] ${issue.message}${location}${details}`;
}
export function formatValidationIssues(issues) {
    if (issues.length === 0)
        return 'No validation issues';
    return issues.map((issue) => formatIssue(issue)).join('\n');
}
export function formatRuntimeError(error) {
    const details = Object.keys(error.details).length > 0 ? ` details=${JSON.stringify(error.details)}` : '';
    return `[${error.code}] ${error.message}${details}`;
}
