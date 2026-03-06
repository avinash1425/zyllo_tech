/**
 * ArthaAI — main.js
 * Shared JS: navigation, scroll effects, mobile menu, tab switcher,
 * scroll animations, smooth scrolling, number counters
 * Zyllo Tech Software Solutions Pvt Ltd
 */

'use strict';

/* ══════════════════════════════════════
   1. NAVIGATION
══════════════════════════════════════ */
(function initNav() {
  const navbar   = document.getElementById('navbar');
  const toggle   = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');

  if (!navbar) return;

  // Scroll: add/remove 'scrolled' class for shadow effect
  const handleScroll = () => {
    navbar.classList.toggle('scrolled', window.scrollY > 20);
  };
  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll(); // run once on load

  // Mobile hamburger toggle
  if (toggle && navLinks) {
    toggle.addEventListener('click', () => {
      const open = navLinks.classList.toggle('open');
      toggle.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open);
    });

    // Close nav when a link is clicked (mobile)
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        toggle.classList.remove('open');
      });
    });

    // Close nav when clicking outside
    document.addEventListener('click', (e) => {
      if (!navbar.contains(e.target)) {
        navLinks.classList.remove('open');
        toggle.classList.remove('open');
      }
    });
  }
})();


/* ══════════════════════════════════════
   2. SMOOTH SCROLLING (anchor links)
══════════════════════════════════════ */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const targetId = this.getAttribute('href').slice(1);
    if (!targetId) return;
    const target = document.getElementById(targetId);
    if (target) {
      e.preventDefault();
      const navH = document.getElementById('navbar')?.offsetHeight || 80;
      const top  = target.getBoundingClientRect().top + window.scrollY - navH - 16;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });
});


/* ══════════════════════════════════════
   3. SCROLL ANIMATIONS (Intersection Observer)
══════════════════════════════════════ */
(function initScrollAnimations() {
  // Classes that trigger animation when in view
  const animatables = document.querySelectorAll(
    '.fade-in, .slide-in-left, .slide-in-right, .scale-in, ' +
    '.feature-card, .module-card, .pricing-card, .step-item, ' +
    '.learn-card, .rp-card, .stat-item'
  );

  if (!animatables.length || !('IntersectionObserver' in window)) {
    // Fallback: show everything
    animatables.forEach(el => el.style.opacity = '1');
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animated');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.12,
    rootMargin: '0px 0px -40px 0px'
  });

  animatables.forEach((el, i) => {
    // Stagger cards in a grid
    el.style.transitionDelay = (i % 4) * 80 + 'ms';
    observer.observe(el);
  });
})();


/* ══════════════════════════════════════
   4. NUMBER COUNTER ANIMATION
══════════════════════════════════════ */
(function initCounters() {
  const counters = document.querySelectorAll('[data-count]');
  if (!counters.length || !('IntersectionObserver' in window)) return;

  const animateCounter = (el) => {
    const target = parseFloat(el.getAttribute('data-count'));
    const suffix = el.getAttribute('data-suffix') || '';
    const prefix = el.getAttribute('data-prefix') || '';
    const duration = 1600;
    const start = performance.now();

    const update = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = target * eased;
      const formatted = target % 1 !== 0 ? current.toFixed(1) : Math.floor(current).toLocaleString('en-IN');
      el.textContent = prefix + formatted + suffix;
      if (progress < 1) requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  counters.forEach(el => observer.observe(el));
})();


/* ══════════════════════════════════════
   5. GENERIC TAB SWITCHER
   Usage: add data-tabs="groupname" to container,
   data-tab="name" to buttons, data-panel="name" to panels
══════════════════════════════════════ */
(function initTabs() {
  document.querySelectorAll('[data-tabs]').forEach(container => {
    const buttons = container.querySelectorAll('[data-tab]');
    const panels  = container.querySelectorAll('[data-panel]');

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-tab');
        buttons.forEach(b => b.classList.toggle('active', b === btn));
        panels.forEach(p => p.classList.toggle('active', p.getAttribute('data-panel') === target));
      });
    });
  });
})();


/* ══════════════════════════════════════
   6. TOAST NOTIFICATION
══════════════════════════════════════ */
window.showToast = function(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;display:flex;flex-direction:column;gap:.5rem;';
    document.body.appendChild(container);
  }

  const colors = {
    success : '#22c55e',
    error   : '#ef4444',
    warning : '#f59e0b',
    info    : '#2E86AB'
  };

  const toast = document.createElement('div');
  toast.style.cssText = `
    background:#fff; border-left:4px solid ${colors[type] || colors.info};
    padding:.75rem 1.2rem; border-radius:8px; box-shadow:0 4px 20px rgba(0,0,0,.12);
    font-size:.88rem; color:#1e293b; max-width:320px;
    animation: slideInToast .3s ease; font-family:inherit;
  `;
  toast.textContent = message;

  if (!document.getElementById('toastStyle')) {
    const style = document.createElement('style');
    style.id = 'toastStyle';
    style.textContent = '@keyframes slideInToast{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:none}}';
    document.head.appendChild(style);
  }

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'none';
    toast.style.opacity   = '0';
    toast.style.transition = 'opacity .3s';
    setTimeout(() => toast.remove(), 300);
  }, duration);
};


/* ══════════════════════════════════════
   7. UTILITY FUNCTIONS (exported to window)
══════════════════════════════════════ */

// Format Indian currency: 1500000 → ₹15,00,000
window.formatINR = function(amount, decimals = 0) {
  if (isNaN(amount)) return '₹0';
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  return (amount < 0 ? '-₹' : '₹') + formatted;
};

// Format large numbers: 1500000 → ₹15L, 12000000 → ₹1.2 Cr
window.formatINRShort = function(amount) {
  if (isNaN(amount)) return '₹0';
  const abs = Math.abs(amount);
  let str;
  if (abs >= 1e7)       str = (abs / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
  else if (abs >= 1e5)  str = (abs / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L';
  else if (abs >= 1e3)  str = (abs / 1e3).toFixed(1).replace(/\.?0+$/, '') + 'K';
  else                  str = Math.round(abs).toString();
  return (amount < 0 ? '-₹' : '₹') + str;
};

// Parse input value safely
window.parseNum = function(id) {
  const el = document.getElementById(id);
  const val = el ? parseFloat(el.value.replace(/,/g, '')) : 0;
  return isNaN(val) ? 0 : val;
};

// Sync slider ↔ input
window.syncRange = function(sliderId, inputId) {
  const slider = document.getElementById(sliderId);
  const input  = document.getElementById(inputId);
  if (!slider || !input) return;
  slider.addEventListener('input', () => { input.value = slider.value; });
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (!isNaN(v)) slider.value = Math.min(Math.max(v, slider.min), slider.max);
  });
};

// Draw simple SVG donut chart
window.drawDonut = function(canvasId, principalPct, interestPct, colors) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !canvas.getContext) return;
  const ctx  = canvas.getContext('2d');
  const cx   = canvas.width  / 2;
  const cy   = canvas.height / 2;
  const r    = Math.min(cx, cy) - 10;
  const inner= r * 0.6;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const segments = [
    { pct: principalPct, color: colors[0] || '#1A3A5C' },
    { pct: interestPct,  color: colors[1] || '#E05C1A' }
  ];

  let startAngle = -Math.PI / 2;
  segments.forEach(seg => {
    const sweep = (seg.pct / 100) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, startAngle + sweep);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();
    startAngle += sweep;
  });

  // Inner white circle (donut hole)
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, 2 * Math.PI);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
};


/* ══════════════════════════════════════
   8. ACTIVE NAV LINK HIGHLIGHT
══════════════════════════════════════ */
(function highlightActiveNav() {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a').forEach(link => {
    const href = link.getAttribute('href');
    if (href && href.split('/').pop() === path) {
      link.classList.add('active');
    }
  });
})();


/* ══════════════════════════════════════
   9. FOOTER YEAR AUTO-UPDATE
══════════════════════════════════════ */
const yearEl = document.querySelector('.footer-year');
if (yearEl) yearEl.textContent = new Date().getFullYear();


/* ══════════════════════════════════════
   10. PREVENT FORM SUBMIT RELOAD
══════════════════════════════════════ */
document.querySelectorAll('form.calc-form, form.planner-form').forEach(form => {
  form.addEventListener('submit', e => e.preventDefault());
});


console.log('%cArthaAI by Zyllo Tech Software Solutions Pvt Ltd', 'color:#E05C1A;font-weight:700;font-size:14px;');
console.log('%cSmart Money Guidance for Every Indian 🇮🇳', 'color:#1A3A5C;font-size:12px;');
