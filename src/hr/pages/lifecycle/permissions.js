// Permission groups for the Onboarding & Employee Exit module. Kept separate
// from the (lazy-loaded) page so HrApp can build navigation without loading it.
export const ONBOARDING_PERMS = ["onboarding.view", "onboarding.view_team", "onboarding.manage"];
export const PROBATION_PERMS = ["probation.view", "probation.view_team", "probation.review_team", "probation.decide"];
export const EXIT_PERMS = ["exit.view", "exit.view_team", "exit.approve_team", "exit.manage"];
export const CLEARANCE_PERMS = [...EXIT_PERMS, "exit.clearance_it", "payroll.manage", "payroll.approve"];
export const SETTLEMENT_PERMS = ["payroll.view"];
export const LIFECYCLE_PERMISSIONS = [...new Set([...ONBOARDING_PERMS, ...PROBATION_PERMS, ...CLEARANCE_PERMS, ...SETTLEMENT_PERMS])];
