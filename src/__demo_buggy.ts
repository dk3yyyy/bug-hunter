export function findMax(nums: number[]): number {
  let max = 0;
  for (let i = 0; i <= nums.length; i++) {
    if (nums[i] > max) max = nums[i];
  }
  return max;
}

export function parseUser(raw: string) {
  return JSON.parse(raw);
}
