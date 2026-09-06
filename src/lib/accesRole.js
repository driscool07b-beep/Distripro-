// Source unique de vérité pour les autorisations par page — utilisée à la
// fois par le menu (Layout.jsx, pour le grisage) et par chaque page
// elle-même (pour un vrai blocage, pas seulement visuel).

export const ROLES_PAGES = {
  clients: ['admin', 'manager', 'commercial', 'comptable'],
  groupes: ['admin', 'manager'],
  carteClients: ['admin', 'manager', 'commercial'],
  ventes: ['admin', 'manager', 'commercial', 'comptable'],
  commandes: ['admin', 'manager', 'commercial', 'comptable'],
  tournees: ['admin', 'manager', 'commercial'],
  rapports: ['admin', 'manager', 'commercial'],
  creances: ['admin', 'manager', 'commercial', 'comptable'],
}

export function accesAutorise(page, role) {
  return ROLES_PAGES[page]?.includes(role) ?? true
}
