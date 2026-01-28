// Сервис проверки геолокации (Haversine formula)

const config = require('../config/env');

// Радиус Земли в км
const EARTH_RADIUS_KM = 6371;

/**
 * Вычисляет расстояние между двумя точками по формуле Haversine
 * @param {number} lat1 - Широта первой точки
 * @param {number} lon1 - Долгота первой точки
 * @param {number} lat2 - Широта второй точки
 * @param {number} lon2 - Долгота второй точки
 * @returns {number} Расстояние в километрах
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => deg * (Math.PI / 180);

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

/**
 * Проверяет, находится ли пользователь в допустимом радиусе от магазина
 * @param {number} userLat - Широта пользователя
 * @param {number} userLon - Долгота пользователя
 * @returns {{ isWithin: boolean, distance: number, distanceFormatted: string }}
 */
function checkLocation(userLat, userLon) {
  const distance = haversineDistance(
    userLat,
    userLon,
    config.storeLatitude,
    config.storeLongitude
  );

  const isWithin = distance <= config.storeRadiusKm;

  // Форматируем расстояние
  let distanceFormatted;
  if (distance < 1) {
    distanceFormatted = `${Math.round(distance * 1000)} м`;
  } else {
    distanceFormatted = `${distance.toFixed(2)} км`;
  }

  return {
    isWithin,
    distance,
    distanceFormatted
  };
}

module.exports = {
  haversineDistance,
  checkLocation
};
