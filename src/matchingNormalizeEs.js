'use strict';

// Webpack/CRA-friendly named re-exports of the shared CJS matching helpers.
const mn = require('./matchingNormalize');

export const normName = mn.normName;
export const nameVariants = mn.nameVariants;
export const namesLooseMatch = mn.namesLooseMatch;
export const normalizeCarrier = mn.normalizeCarrier;
export const normCarrier = mn.normCarrier;
export const carriersMatch = mn.carriersMatch;
export const normalizeCarrierKey = mn.normalizeCarrierKey;
export const toTitleCase = mn.toTitleCase;
