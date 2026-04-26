---
layout: default
title: Home
---

{% assign sorted_screens = site.screens | sort: 'order' %}
{% for screen in sorted_screens %}
<section class="screen{% if screen.has_canvas %} has-canvas{% endif %}">
    {{ screen.content }}
</section>
{% endfor %}
