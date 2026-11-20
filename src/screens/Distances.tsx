import { useHeader } from '../components/Shell'
import { DistanceChart } from '../components/DistanceChart'

export default function Distances() {
  useHeader({ title: 'My distances' })
  return <DistanceChart />
}
