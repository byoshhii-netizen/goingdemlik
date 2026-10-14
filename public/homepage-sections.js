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

    return sections.length ? sections : ['konular'];
  }

  if (typeof window !== 'undefined') {
    window.normalizeHomepageSections = normalizeHomepageSections;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeHomepageSections };
  }
})();
