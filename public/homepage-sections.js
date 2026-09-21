(function () {
  function normalizeHomepageSections(raw) {
    let sections = raw;

    if (typeof sections === 'string') {
      try {
        sections = JSON.parse(sections);
      } catch {
        sections = [sections];
      }
    }

    if (!Array.isArray(sections)) {
      sections = [sections];
    }

    sections = sections
      .map(section => (typeof section === 'string' ? section.trim().toLowerCase() : ''))
      .filter(Boolean);

    if (!sections.length) return ['konular'];

    const normalized = sections.filter(section => section !== 'fotograflar' || sections.length > 1);
    if (!normalized.length || (normalized.length === 1 && normalized[0] === 'fotograflar')) {
      return ['konular'];
    }

    return normalized;
  }

  if (typeof window !== 'undefined') {
    window.normalizeHomepageSections = normalizeHomepageSections;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeHomepageSections };
  }
})();
