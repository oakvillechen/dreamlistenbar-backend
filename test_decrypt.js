import CryptoJS from 'crypto-js';

const assl = 'p8b8FUrvzOCwm423kE8jIpd/MapxlhNkB1iieg6ZzZhZxLZUhKYBzq6vmUuRJf6qCDPGwn7I8FRweJ168ydFBpqOgDN1cTbbEJlKcL1jql/K4ggHxMiP5W1DHBxC5PwQ5oj5QfRn0tsT5UBkYP0AfjQAd7eCrzKL3X+Ry+i3PLbNfJxtC1ZVvhqfXo4DpHtA3vwY/VUfLCSsJ4VG+N++0rLnMNWSXIHU8VfsCDntgTEzVp7ugzT7cDFCilqIruZ11FavRdnH5RF79eW70eb7BihIMcXXliNcU2b1I938/1QhZi2XG/L4qvDUZF9YD8tvuZLwBl9yYwu0abehHcudDc0luAUMzOxjtRWLMfbyzVvyBw8YrpB8xLLZ5ygnsqPkflMZp7uDJ5gLUjVRL3Ww59VSD0tFdEJwSbFtobPA3TvPWFdCesicz2YvzNAZBjEKRqX9ItaxB9swG+SgJrSQL8J6XYKhDUIq1jnoLioko9nnFlWGV0o2bTnuiO9XFvityChk+GJ4xxD8FLezxwOpTpb1+dUuTeXHvFgyfneLm1J5bgvzwtQ8wfbQVJQ4j4Hv+WGn6jRT63t0GXFqwYLQg7kHZa1y5wD9yAuqgji306TmXegSDE6kqXvoxpkh/fxrOeWgSEVIEhdRXylq6iI5NCA4Ej7s8vJmPvJQu5EHMCSmsR6AXquR6N4P5YP4h1MSCoqWMpXhZ72zt3eOECQdua10E2dyFYErEz7TgbAHpuu0MJ/T8bTkPpdEZbo+mKhCGqJKg1XnfO5VpzCtrR2PRrYIg0U7HeYdRSGe0EukaZZ59e5uL3l/UM/O4TRudgPJsBVwdH2cAZ1aNoIdlkh1ykh0m3IGFN45hVf7kiVm84BgcCX4itl2HNTGBlGYUvCaTDQGbL4SbFD209OFl1PL7RnQBUu90mixXTLy6ClO1buoYhlMNhxlUNmE8agHmpdzK2VhmXBdHnOBUrPVgzRi2vQzJmW3xMWRFA+B7p5+sfSeEuw22x2unY0ao+jd76SfEXZbrwJ/h2XsCax6qKYDA1eDfQpA3dQIUS8HuyUUeW2iFmMMzPDw3OzToldxwFfGCiA0F7LBO6jLWD2rdyf0zapBiJ7j7C2ic+FFh69/S5g0znNoz78x3oKh14lPGonkhoju1j4OKeCeSf11Aey3E2sh8hYpM63iCpIYpOyE06hFJmFutsngVNOPBGGWHmiWNp9ISE+5qG7IEzh3FwMgUbkg3t+JPf6PrcFNuDliNe8Sd/CLFyr4KzRP9AElEijYU7/X8oMPkmvwM0haLjqdUY8ls/FHlN2N/7hk5K3qrSDSeXK/9xDfSklBlGJxF9XDpkc9YY0NSeiKxDDVrDVt04KziIbPlljamnqIjk7gqCrbvBjxxhlogtz9VybyVv9on0YTly3dcYveTE5aoSfiBEeiNQdqqsc7q2hDzZQT8vZwWnr8KG4QLxFM4IYk+1XcEB/cBETkWj1d2aZrVPZb4mg8OlWfOJL1aiPLM/foWUjl1333mA7fFLnGV5KS97FzklKmuLPlbAbaZ1sKzlU1R6JGAnSyvOjFNkHWnPFakgSn8281tvbfA9VLy7JJHk9VmgOnq5zb6GWawFt7k236sekdkbcpfaRe7zPEItSvo1t+kJ4NeSDTGBZPPs4qY3Mk2qbOtrJtVXtOaB4nax6P15A0WQF4GlC5vfY2NRbDCfL/iDjQrp4hChw1riohPbZkWt20E4S81e/TTfrSoQMPw9XfBOj6ENjhV/trJaAedxsh8wwjapu8QUDRu3jA+0ZfMa4mYaKKnm7dm0NF9UO/gXnGZXaTBvAd5m4N9DEFXhoEr1xoQ87P9MAb28kTLpxNIJWYcep0NJAT5LAGLurrl9iLDn994FLyc/RbBoHHfQO/BzfKuIY3usVWoyBw+tDCqEXj7T4VW8E=';
const ts = 'a0aa035fbe9e1774472629';
const es = '60';

function tryDecrypt(keyStr, ivStr) {
  try {
    const key = CryptoJS.enc.Utf8.parse(keyStr);
    const iv = CryptoJS.enc.Utf8.parse(ivStr);
    const decrypted = CryptoJS.AES.decrypt(assl, key, { 
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });
    const str = decrypted.toString(CryptoJS.enc.Utf8);
    if (str && (str.startsWith('[') || str.startsWith('{'))) {
      console.log('SUCCESS!');
      console.log('Key:', keyStr);
      console.log('IV:', ivStr);
      console.log('Result:', str);
      return true;
    }
  } catch (e) {}
  return false;
}

const patterns = [];
for (let i = 0; i <= ts.length - 16; i++) {
  const k = ts.substring(i, i + 16);
  patterns.push({ k, i: k.split('').reverse().join('') });
  patterns.push({ k, i: k });
}

const combined = ts + es;
for (let i = 0; i <= combined.length - 16; i++) {
  const k = combined.substring(i, i + 16);
  patterns.push({ k, i: k.split('').reverse().join('') });
}

for (const p of patterns) {
  if (tryDecrypt(p.k, p.i)) process.exit(0);
}
console.log('Failed to find key.');
