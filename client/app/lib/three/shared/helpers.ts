// @ts-nocheck -- shared three.js helpers for the Veyra engines
import * as THREE from 'three';

/** Skin tone palette shared by every avatar. */
export const SKINS = ['#f1c9a5', '#e0a878', '#c9854f', '#8d5a36'];

/** HSL → THREE.Color (hue in degrees). */
export const hsl = (h, s, l) => new THREE.Color().setHSL(h / 360, s, l);
