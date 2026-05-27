// ============================================
// SUPABASE CONFIG - DakarActivités
// ============================================
// Remplacez ces valeurs par vos vraies clés Supabase
const SUPABASE_URL = 'https://kcjzureeycpnhajdtwoz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_8S5uJCdrfyl0mAR7VmzV3Q_rXRXEWPk';

// Initialisation client Supabase
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// SÉCURITÉ : helpers qui échappent toujours les entrées
// ============================================
const Security = {
  // Échappe le HTML pour éviter les injections XSS
  escape(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  },

  // Valide un numéro de téléphone sénégalais
  isValidPhone(phone) {
    return /^(\+221|00221)?[0-9]{9}$/.test(phone.replace(/\s/g, ''));
  },

  // Valide un email
  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  },

  // Génère un token QR sécurisé
  generateToken() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  },

  // Sanitize les inputs avant envoi à Supabase
  sanitize(obj) {
    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
      clean[k] = typeof v === 'string' ? v.trim().slice(0, 1000) : v;
    }
    return clean;
  }
};

// ============================================
// AUTH helpers
// ============================================
const Auth = {
  async signUp(email, password, nom, prenom) {
    if (!Security.isValidEmail(email)) throw new Error('Email invalide');
    if (password.length < 8) throw new Error('Mot de passe trop court (min 8 caractères)');

    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { nom: Security.escape(nom), prenom: Security.escape(prenom) } }
    });
    if (error) throw error;
    return data;
  },

  async signIn(email, password) {
    if (!Security.isValidEmail(email)) throw new Error('Email invalide');
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  async signOut() {
    const { error } = await sb.auth.signOut();
    if (error) throw error;
  },

  async getUser() {
    const { data: { user } } = await sb.auth.getUser();
    return user;
  },

  async isAdmin() {
    const user = await this.getUser();
    if (!user) return false;
    // Le rôle admin est stocké dans les métadonnées Supabase (à définir manuellement)
    return user.email === 'Youssef@dakarPLUG.sn';
  }
};

// ============================================
// ACTIVITÉS helpers
// ============================================
const Activites = {
  async getAll(filters = {}) {
    let query = sb.from('activites').select('*').eq('publiee', true);

    if (filters.categorie) query = query.eq('categorie', filters.categorie);
    if (filters.zone) query = query.ilike('zone', `%${filters.zone}%`);
    if (filters.prix_max) query = query.lte('prix', filters.prix_max);
    if (filters.prix_min) query = query.gte('prix', filters.prix_min);
    if (filters.search) query = query.ilike('nom', `%${filters.search}%`);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async getById(id) {
    const numId = parseInt(id, 10);
    if (!Number.isFinite(numId)) throw new Error('ID invalide');

    const { data, error } = await sb
      .from('activites')
      .select('*, avis(*), disponibilites(*)')
      .eq('id', numId)
      .eq('publiee', true)
      .single();
    if (error) throw error;
    return data;
  },

  async getFavoris(userId) {
    const { data, error } = await sb
      .from('favoris')
      .select('activite_id, activites(*)')
      .eq('user_id', userId);
    if (error) throw error;
    return data || [];
  },

  async toggleFavori(userId, activiteId) {
    const { data: existing } = await sb
      .from('favoris')
      .select('id')
      .eq('user_id', userId)
      .eq('activite_id', activiteId)
      .single();

    if (existing) {
      await sb.from('favoris').delete().eq('id', existing.id);
      return false;
    } else {
      await sb.from('favoris').insert({ user_id: userId, activite_id: activiteId });
      return true;
    }
  }
};

// ============================================
// RÉSERVATIONS helpers
// ============================================
const Reservations = {
  async creer(data) {
    const user = await Auth.getUser();
    if (!user) throw new Error('Connexion requise');

    const clean = Security.sanitize(data);
    const token = Security.generateToken();

    const payload = {
      user_id: user.id,
      activite_id: parseInt(clean.activite_id, 10),
      date: clean.date,
      heure: clean.heure,
      nb_personnes: parseInt(clean.nb_personnes, 10),
      options: clean.options || [],
      montant_total: parseFloat(clean.montant_total),
      methode_paiement: clean.methode_paiement,
      statut: 'en_attente',
      qr_token: token,
      created_at: new Date().toISOString()
    };

    const { data: resa, error } = await sb.from('reservations').insert(payload).select().single();
    if (error) throw error;
    return resa;
  },

  async getMesReservations(userId) {
    const { data, error } = await sb
      .from('reservations')
      .select('*, activites(nom, categorie, image_principale, adresse)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // Admin uniquement
  async getToutes() {
    const isAdmin = await Auth.isAdmin();
    if (!isAdmin) throw new Error('Accès refusé');

    const { data, error } = await sb
      .from('reservations')
      .select('*, activites(nom), profiles(nom, prenom, telephone)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async confirmer(reservationId) {
    const isAdmin = await Auth.isAdmin();
    if (!isAdmin) throw new Error('Accès refusé');

    const { error } = await sb
      .from('reservations')
      .update({ statut: 'confirmee' })
      .eq('id', parseInt(reservationId, 10));
    if (error) throw error;
  }
};

// ============================================
// ADMIN helpers
// ============================================
const Admin = {
  async publierActivite(data) {
    const isAdmin = await Auth.isAdmin();
    if (!isAdmin) throw new Error('Accès refusé');

    const clean = Security.sanitize(data);
    const { data: act, error } = await sb.from('activites').insert({ ...clean, publiee: true }).select().single();
    if (error) throw error;
    return act;
  },

  async modifierActivite(id, data) {
    const isAdmin = await Auth.isAdmin();
    if (!isAdmin) throw new Error('Accès refusé');

    const clean = Security.sanitize(data);
    const { error } = await sb.from('activites').update(clean).eq('id', parseInt(id, 10));
    if (error) throw error;
  },

  async supprimerActivite(id) {
    const isAdmin = await Auth.isAdmin();
    if (!isAdmin) throw new Error('Accès refusé');

    const { error } = await sb.from('activites').update({ publiee: false }).eq('id', parseInt(id, 10));
    if (error) throw error;
  },

  async getStats() {
    const isAdmin = await Auth.isAdmin();
    if (!isAdmin) throw new Error('Accès refusé');

    const [{ count: totalResa }, { count: totalAct }, { data: revenus }] = await Promise.all([
      sb.from('reservations').select('*', { count: 'exact', head: true }),
      sb.from('activites').select('*', { count: 'exact', head: true }).eq('publiee', true),
      sb.from('reservations').select('montant_total').eq('statut', 'confirmee')
    ]);

    const totalRevenus = (revenus || []).reduce((s, r) => s + (r.montant_total || 0), 0);
    return { totalResa, totalAct, totalRevenus };
  }
};

// ============================================
// WHATSAPP redirect helper
// ============================================
function redirectWhatsApp(reservation, activiteNom) {
  const WHATSAPP_NUMBER = '221779913729'; // Remplacez par votre numéro
  const msg = encodeURIComponent(
    `🎟️ Nouvelle réservation - ${Security.escape(activiteNom)}\n` +
    `📅 Date: ${reservation.date} à ${reservation.heure}\n` +
    `👥 Personnes: ${reservation.nb_personnes}\n` +
    `💰 Montant: ${reservation.montant_total.toLocaleString('fr-FR')} FCFA\n` +
    `🔑 Réf: ${reservation.qr_token.slice(0, 8).toUpperCase()}`
  );
  window.open(`https://wa.me/${221779913729}?text=${msg}`, '_blank', 'noopener,noreferrer');
}
// Export global
window.DakarApp = { sb, Security, Auth, Activites, Reservations, Admin, redirectWhatsApp };